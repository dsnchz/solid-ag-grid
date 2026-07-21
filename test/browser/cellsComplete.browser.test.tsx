import { render } from "@solidjs/testing-library";
import type {
  ColDef,
  GridApi,
  GridOptions,
  ICellRendererComp,
  ICellRendererParams,
} from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { createMemo } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
  year: number;
}

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

const mountSolid = <TData,>(props: GridOptions<TData>) => {
  let apiRef: AgGridSolidRef<TData> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...props}
      ref={(r: AgGridSolidRef<TData>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<TData> | undefined };
};

const cellText = (root: Element, rowIndex: number, colId: string) =>
  root.querySelector(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`)?.textContent;

/** A JS (non-framework) cell renderer class with per-grid lifecycle counters. */
const makeJsRenderer = (className: string, refreshResult: boolean) => {
  const counters = { created: 0, refreshed: 0 };
  class JsRenderer implements ICellRendererComp {
    private eGui!: HTMLElement;
    init(params: ICellRendererParams) {
      counters.created++;
      this.eGui = document.createElement("span");
      this.eGui.className = className;
      this.eGui.textContent = `JS-${params.value}`;
    }
    getGui() {
      return this.eGui;
    }
    refresh(params: ICellRendererParams) {
      counters.refreshed++;
      this.eGui.textContent = `JS-${params.value}`;
      return refreshResult;
    }
  }
  return { JsRenderer, counters };
};

/** A JS loading cell renderer (deferRender / async fallback target). */
class JsLoadingRenderer {
  private eGui = document.createElement("span");
  init() {
    this.eGui.className = "my-loading";
    this.eGui.textContent = "loading…";
  }
  getGui() {
    return this.eGui;
  }
  refresh() {
    return true;
  }
}

describe("CellComp complete (browser)", () => {
  it("parity: JS cell renderer create/refresh/recreate lifecycle matches vanilla (setDataValue + refreshCells force)", async () => {
    // price: refresh() returns true (refresh in place); year: refresh() returns false (recreate)
    const solidPrice = makeJsRenderer("js-price", true);
    const vanillaPrice = makeJsRenderer("js-price", true);
    const solidYear = makeJsRenderer("js-year", false);
    const vanillaYear = makeJsRenderer("js-year", false);
    const defs = (
      price: ColDef<CarRow>["cellRenderer"],
      year: ColDef<CarRow>["cellRenderer"],
    ): ColDef<CarRow>[] => [
      { field: "make" },
      { field: "price", cellRenderer: price },
      { field: "year", cellRenderer: year },
    ];

    // each grid gets its own row objects — setDataValue mutates them in place
    const vanilla = mountVanilla<CarRow>({
      columnDefs: defs(vanillaPrice.JsRenderer, vanillaYear.JsRenderer),
      rowData: rowData.map((row) => ({ ...row })),
    });
    const solid = mountSolid<CarRow>({
      columnDefs: defs(solidPrice.JsRenderer, solidYear.JsRenderer),
      rowData: rowData.map((row) => ({ ...row })),
    });

    await waitFor(() => solid.container.querySelectorAll(".js-price").length === 3);
    await waitFor(() => vanilla.container.querySelectorAll(".js-price").length === 3);

    // DOM parity: same rendered text, and the renderer gui sits inside the cell element
    for (let i = 0; i < 3; i++) {
      expect(cellText(solid.container, i, "price")).toBe(cellText(vanilla.container, i, "price"));
      expect(cellText(solid.container, i, "year")).toBe(cellText(vanilla.container, i, "year"));
    }
    const solidGui = solid.container.querySelector(".js-price")!;
    const vanillaGui = vanilla.container.querySelector(".js-price")!;
    expect(solidGui.closest(".ag-cell")).not.toBeNull();
    expect(solidGui.parentElement!.classList.contains("ag-cell")).toBe(
      vanillaGui.parentElement!.classList.contains("ag-cell"),
    );
    expect(solidPrice.counters).toEqual(vanillaPrice.counters);
    expect(solidPrice.counters.created).toBe(3);

    // refresh path: value change refreshes the live instance in place, no recreation
    solid.api()!.forEachNode((node) => node.setDataValue("price", node.data!.price + 1));
    vanilla.api.forEachNode((node) => node.setDataValue("price", node.data!.price + 1));
    await waitFor(() => cellText(solid.container, 0, "price") === "JS-35001");
    await waitFor(() => cellText(vanilla.container, 0, "price") === "JS-35001");
    expect(solidPrice.counters.refreshed).toBeGreaterThan(0);
    expect(solidPrice.counters).toEqual(vanillaPrice.counters);
    expect(solidPrice.counters.created).toBe(3);

    // force path: refresh-returning-true renderers refresh again; refresh-returning-false
    // renderers are destroyed and recreated — both exactly like vanilla
    solid.api()!.refreshCells({ force: true });
    vanilla.api.refreshCells({ force: true });
    await waitFor(() => vanillaYear.counters.created === 6);
    await waitFor(() => solidYear.counters.created === 6);
    expect(solidPrice.counters).toEqual(vanillaPrice.counters);
    expect(solidYear.counters).toEqual(vanillaYear.counters);
    expect(cellText(solid.container, 0, "price")).toBe(cellText(vanilla.container, 0, "price"));
    expect(cellText(solid.container, 0, "year")).toBe(cellText(vanilla.container, 0, "year"));

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: multiRow checkbox selection renders the tool widgets like vanilla and clicking updates getSelectedRows()", async () => {
    const options: GridOptions<CarRow> = {
      columnDefs: [{ field: "make" }, { field: "price" }],
      rowData,
      rowSelection: { mode: "multiRow", checkboxes: true, enableClickSelection: false },
    };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);

    await waitFor(
      () => solid.container.querySelectorAll(".ag-cell .ag-selection-checkbox").length === 3,
    );
    await waitFor(
      () => vanilla.container.querySelectorAll(".ag-cell .ag-selection-checkbox").length === 3,
    );

    // structural parity inside the cell wrapper: tool widget then value span, same classes
    const wrapperChildClasses = (root: Element) => {
      const wrapper = root.querySelector(
        '.ag-row[row-index="0"] .ag-cell .ag-selection-checkbox',
      )!.parentElement!;
      expect(wrapper.classList.contains("ag-cell-wrapper")).toBe(true);
      return Array.from(wrapper.children).map((child) =>
        Array.from(child.classList)
          .filter((cls) => !cls.startsWith("ag-checkbox-")) // transient focus classes
          .sort()
          .join(" "),
      );
    };
    expect(wrapperChildClasses(solid.container)).toEqual(wrapperChildClasses(vanilla.container));

    // behavior parity: click row 1's checkbox in both grids
    const clickCheckbox = (root: Element) => {
      const input = root.querySelector<HTMLElement>(
        '.ag-row[row-index="1"] .ag-selection-checkbox input',
      )!;
      input.click();
    };
    clickCheckbox(solid.container);
    clickCheckbox(vanilla.container);
    await waitFor(() => solid.api()!.getSelectedRows().length === 1);
    await waitFor(() => vanilla.api.getSelectedRows().length === 1);
    expect(solid.api()!.getSelectedRows()).toEqual(vanilla.api.getSelectedRows());
    expect(solid.api()!.getSelectedRows()[0]!.make).toBe("Ford");

    // and the row gets the selected style like vanilla
    await waitFor(
      () =>
        solid.container
          .querySelector('.ag-row[row-index="1"]')!
          .classList.contains("ag-row-selected") === true,
    );

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: rowDrag renders drag handles like vanilla and managed drag reorders rows", async () => {
    const options: GridOptions<CarRow> = {
      columnDefs: [{ field: "make", rowDrag: true }, { field: "price" }],
      rowData: rowData.map((row) => ({ ...row })),
      rowDragManaged: true,
      animateRows: false,
    };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);

    await waitFor(() => solid.container.querySelectorAll(".ag-cell .ag-row-drag").length === 3);
    await waitFor(() => vanilla.container.querySelectorAll(".ag-cell .ag-row-drag").length === 3);

    // handle parity: same classes on the drag handle element
    const handleClasses = (root: Element) =>
      Array.from(root.querySelector('.ag-row[row-index="0"] .ag-row-drag')!.classList).sort();
    expect(handleClasses(solid.container)).toEqual(handleClasses(vanilla.container));

    // managed drag: drag row 0's handle below row 1 → order swaps
    const handle = solid.container.querySelector<HTMLElement>(
      '.ag-row[row-index="0"] .ag-row-drag',
    )!;
    const from = handle.getBoundingClientRect();
    const row1 = solid.container.querySelector<HTMLElement>('.ag-row[row-index="1"]')!;
    const to = row1.getBoundingClientRect();
    const mouse = (target: EventTarget, type: string, x: number, y: number) =>
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
    mouse(handle, "mousedown", from.x + 2, from.y + 2);
    mouse(document, "mousemove", from.x + 2, from.y + 10);
    await settle();
    mouse(document, "mousemove", to.x + 20, to.y + to.height - 2);
    await settle();
    mouse(document, "mouseup", to.x + 20, to.y + to.height - 2);

    await waitFor(() => cellText(solid.container, 0, "make") === "Ford");
    expect(cellText(solid.container, 1, "make")).toBe("Toyota");

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: cell spanning renders ag-spanned-cell-wrapper with the same count and geometry as vanilla", async () => {
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
    const options: GridOptions<CarRow> = {
      columnDefs: spanDefs,
      rowData: spanData,
      enableCellSpan: true,
    };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);

    await waitFor(() => solid.container.querySelectorAll(".ag-spanned-cell-wrapper").length > 0);
    await waitFor(() => vanilla.container.querySelectorAll(".ag-spanned-cell-wrapper").length > 0);
    await settle();

    // only multi-row spans get the wrapper (Ford covers a single row → no wrapper), so both
    // grids render exactly one spanned cell: the two-row Toyota span
    const solidSpans = solid.container.querySelectorAll<HTMLElement>(".ag-spanned-cell-wrapper");
    const vanillaSpans = vanilla.container.querySelectorAll<HTMLElement>(
      ".ag-spanned-cell-wrapper",
    );
    expect(solidSpans.length).toBe(vanillaSpans.length);
    expect(solidSpans.length).toBe(1);
    expect(solidSpans[0]!.textContent).toBe("Toyota");
    expect(vanillaSpans[0]!.textContent).toBe("Toyota");

    // geometry parity: the Toyota span covers two rows — same height/width as vanilla
    const solidSpan = solidSpans[0]!.getBoundingClientRect();
    const vanillaSpan = vanillaSpans[0]!.getBoundingClientRect();
    expect(solidSpan.height, "span height").toBe(vanillaSpan.height);
    expect(solidSpan.width, "span width").toBe(vanillaSpan.width);
    // structural parity: the spanned wrapper contains the cell element
    expect(solidSpans[0]!.querySelector(".ag-cell")).not.toBeNull();
    expect(vanillaSpans[0]!.querySelector(".ag-cell")).not.toBeNull();
    // the spanned Toyota cell is taller than a single row
    const singleRowHeight = solid.container
      .querySelector('.ag-row[row-index="0"]')!
      .getBoundingClientRect().height;
    expect(solidSpan.height).toBeGreaterThan(singleRowHeight);

    vanilla.destroy();
    solid.unmount();
  });

  it("defer render: cellRendererParams.deferRender renders final values without errors; scrolled cells show the loading comp first", async () => {
    const DeferredRenderer = (props: ICellRendererParams<CarRow, string>) => (
      <span class="deferred-cell">{`D-${props.value}`}</span>
    );
    const bigData: CarRow[] = Array.from({ length: 300 }, (_, i) => ({
      make: `Make ${i}`,
      price: 1000 + i,
      year: 1900 + (i % 100),
    }));
    const errorSpy = vi.spyOn(console, "error");
    const solid = mountSolid<CarRow>({
      columnDefs: [
        {
          field: "make",
          cellRenderer: DeferredRenderer,
          cellRendererParams: { deferRender: true },
          loadingCellRenderer: JsLoadingRenderer,
        },
        { field: "price" },
      ],
      rowData: bigData,
    });

    // not scrolling: onReady resolves immediately, the real renderer shows with no errors
    await waitFor(() => solid.container.querySelectorAll(".deferred-cell").length > 0);
    expect(cellText(solid.container, 0, "make")).toBe("D-Make 0");

    // while scrolling, freshly created cells defer behind the loading comp, then swap
    const viewport = solid.container.querySelector<HTMLElement>(".ag-grid-viewport")!;
    let sawLoading = false;
    for (let step = 1; step <= 8; step++) {
      viewport.scrollTop = step * 700;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      sawLoading ||= solid.container.querySelector(".my-loading") != null;
    }
    // after the scroll settles every visible cell swaps to its real renderer
    await waitFor(
      () =>
        solid.container.querySelector(".my-loading") == null &&
        solid.container.querySelectorAll(".deferred-cell").length > 0,
    );
    expect(sawLoading, "loading comp was shown for cells created mid-scroll").toBe(true);
    const visible = solid.container.querySelectorAll(".deferred-cell");
    for (const cell of visible) {
      expect(cell.textContent).toMatch(/^D-Make \d+$/);
    }
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    solid.unmount();
  });

  it("async framework cell renderer suspends into the per-cell <Loading> boundary and reveals when the data settles (Open question 4)", async () => {
    let resolveDetail!: (value: string) => void;
    const detailPromise = new Promise<string>((resolve) => (resolveDetail = resolve));
    const AsyncRenderer = (props: ICellRendererParams<CarRow, string>) => {
      // zero-ceremony async: the renderer reads an async computation directly
      const detail = createMemo(() => detailPromise);
      return <span class="async-cell">{`${props.value}:${detail()}`}</span>;
    };
    const errorSpy = vi.spyOn(console, "error");
    const solid = mountSolid<CarRow>({
      columnDefs: [
        { field: "make", cellRenderer: AsyncRenderer, loadingCellRenderer: JsLoadingRenderer },
        { field: "price" },
      ],
      rowData,
    });

    // pending: every make cell shows the grid's loading cell renderer, none the real content
    await waitFor(() => solid.container.querySelectorAll(".my-loading").length === 3);
    expect(solid.container.querySelectorAll(".async-cell").length).toBe(0);

    resolveDetail("ok");
    await waitFor(() => solid.container.querySelectorAll(".async-cell").length === 3);
    expect(cellText(solid.container, 0, "make")).toBe("Toyota:ok");
    expect(solid.container.querySelectorAll(".my-loading").length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    solid.unmount();
  });

  it("async framework cell renderer with a framework loading comp (skeleton framework branch)", async () => {
    let resolveDetail!: (value: string) => void;
    const detailPromise = new Promise<string>((resolve) => (resolveDetail = resolve));
    const AsyncRenderer = (props: ICellRendererParams<CarRow, string>) => {
      const detail = createMemo(() => detailPromise);
      return <span class="async-cell">{`${props.value}:${detail()}`}</span>;
    };
    const SolidLoading = () => <span class="solid-loading">…</span>;
    const solid = mountSolid<CarRow>({
      columnDefs: [
        { field: "make", cellRenderer: AsyncRenderer, loadingCellRenderer: SolidLoading },
        { field: "price" },
      ],
      rowData,
    });

    await waitFor(() => solid.container.querySelectorAll(".solid-loading").length === 3);
    resolveDetail("ok");
    await waitFor(() => solid.container.querySelectorAll(".async-cell").length === 3);
    expect(solid.container.querySelectorAll(".solid-loading").length).toBe(0);

    solid.unmount();
  });

  it("batching sanity: 10 rapid setGridOption('rowData') calls in one tick produce untorn final content", async () => {
    const makeData = (generation: number): CarRow[] =>
      Array.from({ length: 5 }, (_, i) => ({
        make: `G${generation}-Row${i}`,
        price: generation * 100 + i,
        year: 2000 + generation,
      }));
    const errorSpy = vi.spyOn(console, "error");
    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make" }, { field: "price" }, { field: "year" }],
      rowData: makeData(0),
    });
    await waitFor(() => solid.container.querySelectorAll(".ag-row").length === 5);

    for (let generation = 1; generation <= 10; generation++) {
      solid.api()!.setGridOption("rowData", makeData(generation));
    }
    await waitFor(() => cellText(solid.container, 0, "make") === "G10-Row0");
    await settle();

    // every cell belongs to generation 10 — no interleaved/torn content across the batch
    for (let i = 0; i < 5; i++) {
      expect(cellText(solid.container, i, "make")).toBe(`G10-Row${i}`);
      expect(cellText(solid.container, i, "price")).toBe(String(1000 + i));
      expect(cellText(solid.container, i, "year")).toBe("2010");
    }
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    solid.unmount();
  });
});
