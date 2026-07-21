import { render } from "@solidjs/testing-library";
import type { ColDef, GridOptions, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { createMemo, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
  year: number;
}

const columnDefs: ColDef<CarRow>[] = [{ field: "make" }, { field: "price" }, { field: "year" }];
const rowData: CarRow[] = [
  { make: "Toyota", price: 35000, year: 2020 },
  { make: "Ford", price: 32000, year: 2018 },
  { make: "Porsche", price: 72000, year: 2022 },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Polls until cond() is truthy (grid readiness spans several microtask flushes + timers). */
const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

/** Mounts a vanilla (createGrid) grid with the given options; returns its container + destroy. */
const mountVanilla = <TData,>(options: GridOptions<TData>) => {
  const container = document.createElement("div");
  container.style.height = "300px";
  container.style.width = "600px";
  document.body.appendChild(container);
  const api = createGrid(container, options);
  return {
    container,
    api,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
};

/** row-index → { row element, colId → cell text } for every rendered row. */
const collectRows = (root: Element) => {
  const rows = new Map<string, { el: HTMLElement; cells: Map<string, string> }>();
  for (const row of root.querySelectorAll<HTMLElement>(".ag-row")) {
    const rowIndex = row.getAttribute("row-index");
    if (rowIndex == null) {
      continue;
    }
    const cells = new Map<string, string>();
    for (const cell of row.querySelectorAll<HTMLElement>(".ag-cell")) {
      cells.set(cell.getAttribute("col-id")!, cell.textContent ?? "");
    }
    rows.set(rowIndex, { el: row, cells });
  }
  return rows;
};

describe("RowComp + CellComp (browser)", () => {
  it("parity: 3x3 cell text, row-index/row-id attributes and row/cell DOM structure match vanilla", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-row").length >= 3);
    await waitFor(() => vanilla.container.querySelectorAll(".ag-row").length >= 3);
    await settle();

    const vRows = collectRows(vanilla.container);
    const sRows = collectRows(container);
    expect([...sRows.keys()].sort()).toEqual([...vRows.keys()].sort());
    expect(sRows.size).toBe(3);

    for (const [rowIndex, vRow] of vRows) {
      const sRow = sRows.get(rowIndex)!;
      // cell text parity per column
      expect(Object.fromEntries(sRow.cells), `cells differ for row ${rowIndex}`).toEqual(
        Object.fromEntries(vRow.cells),
      );
      // row attribute parity
      expect(sRow.el.getAttribute("row-id")).toBe(vRow.el.getAttribute("row-id"));
      expect(sRow.el.getAttribute("role")).toBe(vRow.el.getAttribute("role"));
      // v36 per-row lane structure: cells live inside the scrolling lane
      const sLane = sRow.el.querySelector(".ag-grid-scrolling-cells");
      const vLane = vRow.el.querySelector(".ag-grid-scrolling-cells");
      expect(sLane, `row ${rowIndex} is missing the scrolling lane`).not.toBeNull();
      expect(vLane).not.toBeNull();
      expect(sRow.el.style.top).toBe(vRow.el.style.top);
      expect(sRow.el.style.transform).toBe(vRow.el.style.transform);
    }

    // cell renders the value directly (no wrapper span without tools) with ag-cell-value class
    const sCell = container.querySelector('.ag-row[row-index="0"] .ag-cell[col-id="make"]')!;
    const vCell = vanilla.container.querySelector(
      '.ag-row[row-index="0"] .ag-cell[col-id="make"]',
    )!;
    expect(Array.from(sCell.classList).sort()).toEqual(Array.from(vCell.classList).sort());

    vanilla.destroy();
    unmount();
  });

  it("parity: pinned:'left' column renders in the left lane with matching widths vs vanilla", async () => {
    const pinnedDefs: ColDef<CarRow>[] = [
      { field: "make", pinned: "left" },
      { field: "price" },
      { field: "year" },
    ];
    const options: GridOptions<CarRow> = { columnDefs: pinnedDefs, rowData };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={pinnedDefs}
        rowData={rowData}
      />
    ));
    await waitFor(
      () => container.querySelectorAll(".ag-row .ag-grid-pinned-left-cells").length >= 3,
    );
    await settle();

    const sRow = container.querySelector<HTMLElement>('.ag-row[row-index="0"]')!;
    const vRow = vanilla.container.querySelector<HTMLElement>('.ag-row[row-index="0"]')!;

    const sLeft = sRow.querySelector<HTMLElement>(".ag-grid-pinned-left-cells")!;
    const vLeft = vRow.querySelector<HTMLElement>(".ag-grid-pinned-left-cells")!;
    expect(sLeft.style.width).toBe(vLeft.style.width);
    // pinned lanes wrap their cells in ag-grid-container-wrapper
    expect(sLeft.querySelector(".ag-grid-container-wrapper")).not.toBeNull();
    expect(vLeft.querySelector(".ag-grid-container-wrapper")).not.toBeNull();
    // the pinned column's cell is inside the left lane, the others in the scrolling lane
    expect(sLeft.querySelector('.ag-cell[col-id="make"]')).not.toBeNull();
    expect(sRow.querySelector('.ag-grid-scrolling-cells .ag-cell[col-id="price"]')).not.toBeNull();
    expect(sRow.querySelector('.ag-grid-scrolling-cells .ag-cell[col-id="make"]')).toBeNull();

    const sScroll = sRow.querySelector<HTMLElement>(".ag-grid-scrolling-cells")!;
    const vScroll = vRow.querySelector<HTMLElement>(".ag-grid-scrolling-cells")!;
    expect(sScroll.style.width).toBe(vScroll.style.width);

    vanilla.destroy();
    unmount();
  });

  it("sorting via api.applyColumnState reorders rows to match vanilla and preserves element identity (domOrder false)", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData };
    const vanilla = mountVanilla(options);
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
        ref={(r) => (apiRef = r)}
      />
    ));
    await waitFor(() => apiRef != null && container.querySelectorAll(".ag-row").length >= 3);
    await settle();

    const beforeById = new Map<string, HTMLElement>();
    for (const row of container.querySelectorAll<HTMLElement>(".ag-row")) {
      beforeById.set(row.getAttribute("row-id")!, row);
    }

    const sortState = { state: [{ colId: "make", sort: "asc" as const }] };
    vanilla.api.applyColumnState(sortState);
    apiRef!.api.applyColumnState(sortState);
    await settle();
    await waitFor(() => {
      const rows = collectRows(container);
      return rows.get("0")?.cells.get("make") === "Ford";
    });

    const vRows = collectRows(vanilla.container);
    const sRows = collectRows(container);
    for (const [rowIndex, vRow] of vRows) {
      expect(sRows.get(rowIndex)!.cells.get("make"), `row ${rowIndex}`).toBe(
        vRow.cells.get("make"),
      );
    }

    // transition-preserving diff: the surviving rows keep their DOM element identity
    for (const row of container.querySelectorAll<HTMLElement>(".ag-row")) {
      const rowId = row.getAttribute("row-id")!;
      expect(beforeById.get(rowId), `element identity lost for row ${rowId}`).toBe(row);
    }

    vanilla.destroy();
    unmount();
  });

  it("scroll parity: 500 rows virtualize, api.ensureIndexVisible(400) shows row 400 without console errors (flush + ensureVisible latch)", async () => {
    const bigData: CarRow[] = Array.from({ length: 500 }, (_, i) => ({
      make: `Make ${i}`,
      price: 1000 + i,
      year: 1900 + (i % 100),
    }));
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const errorSpy = vi.spyOn(console, "error");
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={bigData}
        ref={(r) => (apiRef = r)}
      />
    ));
    await waitFor(() => apiRef != null && container.querySelectorAll(".ag-row").length > 0);
    await settle();

    // virtualisation: DOM row count is far below the 500 in the model
    const initialDomRows = container.querySelectorAll(".ag-row").length;
    expect(initialDomRows).toBeGreaterThan(0);
    expect(initialDomRows).toBeLessThan(100);

    errorSpy.mockClear();
    apiRef!.api.ensureIndexVisible(400);
    await waitFor(() => container.querySelector('.ag-row[row-index="400"]') != null);
    await settle();

    const row400 = collectRows(container).get("400")!;
    expect(row400.cells.get("make")).toBe("Make 400");

    expect(container.querySelectorAll(".ag-row").length).toBeLessThan(100);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    unmount();
  });

  it("api.applyTransaction adds/removes rows; removing all rows shows the no-rows overlay", async () => {
    const initialRows: CarRow[] = rowData.map((row) => ({ ...row }));
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={initialRows}
        ref={(r) => (apiRef = r)}
      />
    ));
    await waitFor(() => apiRef != null && container.querySelectorAll(".ag-row").length >= 3);

    const added: CarRow = { make: "Tesla", price: 45000, year: 2024 };
    apiRef!.api.applyTransaction({ add: [added] });
    await waitFor(() => container.querySelectorAll(".ag-row").length === 4);
    expect(
      Array.from(container.querySelectorAll('.ag-cell[col-id="make"]')).map((el) => el.textContent),
    ).toContain("Tesla");

    apiRef!.api.applyTransaction({ remove: [added] });
    await waitFor(() => container.querySelectorAll(".ag-row").length === 3);

    // remove everything → no-rows overlay
    const remaining: CarRow[] = [];
    apiRef!.api.forEachNode((node) => remaining.push(node.data!));
    apiRef!.api.applyTransaction({ remove: remaining });
    await waitFor(() => container.querySelector(".ag-overlay-no-rows-center") != null);
    // rows animate out before the ctrls are retired — wait for the DOM to drain
    await waitFor(() => container.querySelectorAll(".ag-row").length === 0);

    unmount();
  });

  it("framework (Solid) cell renderer receives params and re-renders when rowData updates", async () => {
    const seenValues: number[] = [];
    const PriceRenderer = (props: ICellRendererParams<CarRow, number>) => {
      return (
        <span class="my-price-renderer">
          {(() => {
            seenValues.push(props.value!);
            return `£${props.value}`;
          })()}
        </span>
      );
    };
    const rendererDefs: ColDef<CarRow>[] = [
      { field: "make" },
      { field: "price", cellRenderer: PriceRenderer },
    ];
    const [rows, setRows] = createSignal<CarRow[]>([{ make: "Toyota", price: 35000, year: 2020 }]);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={rendererDefs}
        rowData={rows()}
      />
    ));
    await waitFor(() => container.querySelector(".my-price-renderer") != null);
    expect(container.querySelector(".my-price-renderer")!.textContent).toBe("£35000");
    expect(seenValues).toContain(35000);

    setRows([{ make: "Toyota", price: 42000, year: 2020 }]);
    await waitFor(() => container.querySelector(".my-price-renderer")?.textContent === "£42000");
    expect(seenValues).toContain(42000);

    unmount();
  });

  it("no empty-row flash: rows never paint bare before their cells arrive (Open question 7)", async () => {
    const flashData: CarRow[] = Array.from({ length: 50 }, (_, i) => ({
      make: `Make ${i}`,
      price: 1000 + i,
      year: 2000 + (i % 20),
    }));

    const frames: { rows: number; rowsWithCells: number }[] = [];
    let sampling = true;
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={flashData}
      />
    ));

    // sample every painted frame from mount until (a couple frames after) rows appear
    let framesAfterRows = 0;
    await new Promise<void>((resolve) => {
      const sample = () => {
        if (!sampling) {
          resolve();
          return;
        }
        const rows = container.querySelectorAll(".ag-row");
        let rowsWithCells = 0;
        for (const row of rows) {
          if (row.querySelector(".ag-cell") != null) {
            rowsWithCells++;
          }
        }
        frames.push({ rows: rows.length, rowsWithCells });
        if (rows.length > 0 && ++framesAfterRows > 3) {
          sampling = false;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    expect(frames.length).toBeGreaterThan(0);
    // in every painted frame, rows that exist already carry their cells — the initial-state
    // seeding (getInitialCellCtrls + top/transform) prevents an empty-row frame
    for (const frame of frames) {
      if (frame.rows > 0) {
        expect(frame.rowsWithCells, `painted frame had bare rows: ${JSON.stringify(frame)}`).toBe(
          frame.rows,
        );
      }
    }

    unmount();
  });

  it("cell spanning smoke: enableCellSpan renders the spanning container and rows without crashing (parity in T3.5)", async () => {
    const spanDefs: ColDef<CarRow>[] = [
      { field: "make", spanRows: true },
      { field: "price" },
      { field: "year" },
    ];
    const spanData: CarRow[] = [
      { make: "Toyota", price: 1, year: 2020 },
      { make: "Toyota", price: 2, year: 2021 },
      { make: "Ford", price: 3, year: 2022 },
    ];
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={spanDefs}
        rowData={spanData}
        enableCellSpan={true}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-row").length >= 3);
    expect(container.querySelector(".ag-spanning-container")).not.toBeNull();
    unmount();
  });

  it("async rowData (Open question 9): grid boots with the loading overlay, rows arrive on resolve, other props are not stalled", async () => {
    let resolveData!: (rows: CarRow[]) => void;
    const dataPromise = new Promise<CarRow[]>((resolve) => (resolveData = resolve));

    const [cols, setCols] = createSignal<ColDef<CarRow>[]>([{ field: "make" }, { field: "price" }]);
    const onGridReadySpy = vi.fn();

    const Harness = () => {
      // zero-ceremony async rowData: an async memo read straight into the prop
      const asyncRows = createMemo(() => dataPromise);
      return (
        <AgGridSolid
          containerStyle={{ height: "300px", width: "600px" }}
          columnDefs={cols()}
          rowData={asyncRows()}
          onGridReady={onGridReadySpy}
        />
      );
    };
    const { container, unmount } = render(() => <Harness />);

    // the grid boots with rowData treated as undefined → loading overlay, no crash
    await waitFor(() => onGridReadySpy.mock.calls.length > 0);
    await waitFor(() => container.querySelector(".ag-overlay-loading-center") != null);
    expect(container.querySelectorAll(".ag-row").length).toBe(0);

    // per-key isolation: a pending rowData does not stall other prop changes
    setCols([{ field: "make" }, { field: "price" }, { headerName: "Extra", colId: "extra" }]);
    await waitFor(() => container.querySelectorAll(".ag-header-cell").length === 3);
    expect(container.querySelectorAll(".ag-row").length).toBe(0);

    // resolve → the prop-diff compute re-runs and pushes rowData like any other option change
    resolveData(rowData);
    await waitFor(() => container.querySelectorAll(".ag-row").length === 3);
    const rows = collectRows(container);
    expect(rows.get("0")!.cells.get("make")).toBe("Toyota");
    expect(container.querySelector(".ag-overlay-loading-center")).toBeNull();

    unmount();
  });
});
