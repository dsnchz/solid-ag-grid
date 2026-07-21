import { render } from "@solidjs/testing-library";
import type { ColDef, GridOptions, RowContainerName } from "ag-grid-community";
import {
  _getRowContainerClass,
  AllCommunityModule,
  createGrid,
  ModuleRegistry,
} from "ag-grid-community";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
}

const columnDefs: ColDef<CarRow>[] = [{ field: "make" }, { field: "price" }];
const rowData: CarRow[] = [
  { make: "Toyota", price: 35000 },
  { make: "Ford", price: 32000 },
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
const mountVanilla = (options: GridOptions<CarRow>) => {
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

const sortedClasses = (el: Element) => Array.from(el.classList).sort();

const ROW_CONTAINER_NAMES: RowContainerName[] = [
  "scrolling",
  "pinnedTop",
  "pinnedBottom",
  "stickyTop",
  "stickyBottom",
];

describe("GridBodyComp + header shell (browser)", () => {
  it("fires onGridReady, surfaces the api via ref, and renders column headers with correct titles", async () => {
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const onGridReadySpy = vi.fn();
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
        ref={(r) => (apiRef = r)}
        onGridReady={onGridReadySpy}
      />
    ));

    await waitFor(() => onGridReadySpy.mock.calls.length > 0);
    expect(onGridReadySpy).toHaveBeenCalledTimes(1);
    expect(apiRef).toBeDefined();
    expect(apiRef!.api.isDestroyed()).toBe(false);

    await waitFor(() => container.querySelectorAll(".ag-header-cell-text").length === 2);
    const headerTexts = Array.from(container.querySelectorAll(".ag-header-cell-text")).map(
      (el) => el.textContent,
    );
    expect(headerTexts).toEqual(["Make", "Price"]);
    // header cells are visible (real layout)
    for (const cell of container.querySelectorAll(".ag-header-cell")) {
      expect(cell.getBoundingClientRect().width).toBeGreaterThan(0);
    }

    unmount();
  });

  it("parity: body skeleton matches vanilla (viewport/scrollable-area hierarchy, pinned sections, 5 row containers, fake scrollbars)", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));
    await waitFor(() => container.querySelector(".ag-grid-scrollable-area") != null);
    await settle();

    const selectors = [
      ".ag-root",
      ".ag-grid-viewport",
      ".ag-grid-scrollable-area",
      ".ag-grid-pinned-top-rows",
      ".ag-grid-scrolling-rows",
      ".ag-grid-pinned-bottom-rows",
      ".ag-extra-rows-container",
      ".ag-header",
      ".ag-body-horizontal-scroll",
      ".ag-body-vertical-scroll",
      ...ROW_CONTAINER_NAMES.map((name) => `.${_getRowContainerClass(name)}`),
    ];

    for (const selector of selectors) {
      const vEl = vanilla.container.querySelector(selector);
      const sEl = container.querySelector(selector);
      expect(vEl, `vanilla is missing ${selector}`).not.toBeNull();
      expect(sEl, `solid is missing ${selector}`).not.toBeNull();
      expect(sortedClasses(sEl!), `classes differ for ${selector}`).toEqual(sortedClasses(vEl!));
    }

    // v36 hierarchy: ag-root > ag-grid-viewport > ag-grid-scrollable-area, top/body/bottom inside
    const sViewport = container.querySelector(".ag-grid-viewport")!;
    expect(sViewport.parentElement!.classList.contains("ag-root")).toBe(true);
    const sScrollable = container.querySelector(".ag-grid-scrollable-area")!;
    expect(sScrollable.parentElement).toBe(sViewport);
    expect(sScrollable.getAttribute("role")).toBe("rowgroup");
    for (const sectionClass of [
      "ag-grid-pinned-top-rows",
      "ag-grid-scrolling-rows",
      "ag-grid-pinned-bottom-rows",
    ]) {
      expect(container.querySelector(`.${sectionClass}`)!.parentElement).toBe(sScrollable);
    }

    // CSS vars: the top section carries --ag-top-rows-height / --ag-header-rows-height like vanilla
    const vTop = vanilla.container.querySelector<HTMLElement>(".ag-grid-pinned-top-rows")!;
    const sTop = container.querySelector<HTMLElement>(".ag-grid-pinned-top-rows")!;
    expect(sTop.style.getPropertyValue("--ag-top-rows-height")).toBe(
      vTop.style.getPropertyValue("--ag-top-rows-height"),
    );
    expect(sTop.style.getPropertyValue("--ag-header-rows-height")).toBe(
      vTop.style.getPropertyValue("--ag-header-rows-height"),
    );

    // fake scrollbars live as direct children of ag-root in both
    expect(container.querySelector(".ag-body-horizontal-scroll")!.parentElement).toBe(
      container.querySelector(".ag-root"),
    );
    expect(container.querySelector(".ag-body-vertical-scroll")!.parentElement).toBe(
      container.querySelector(".ag-root"),
    );

    vanilla.destroy();
    unmount();
  });

  it("parity: header DOM matches vanilla (row count, aria, col-ids, widths, sort state)", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-header-cell").length === 2);
    await settle();

    const vRows = vanilla.container.querySelectorAll(".ag-header-row");
    const sRows = container.querySelectorAll(".ag-header-row");
    expect(sRows.length).toBe(vRows.length);
    for (let i = 0; i < vRows.length; i++) {
      expect(sortedClasses(sRows[i]!)).toEqual(sortedClasses(vRows[i]!));
      expect(sRows[i]!.getAttribute("aria-rowindex")).toBe(vRows[i]!.getAttribute("aria-rowindex"));
    }

    const collectCells = (root: Element) => {
      const cells = new Map<string, Element>();
      for (const cell of root.querySelectorAll(".ag-header-cell")) {
        cells.set(cell.getAttribute("col-id")!, cell);
      }
      return cells;
    };
    const vCells = collectCells(vanilla.container);
    const sCells = collectCells(container);
    expect([...sCells.keys()].sort()).toEqual([...vCells.keys()].sort());
    for (const [colId, vCell] of vCells) {
      const sCell = sCells.get(colId)!;
      expect(sortedClasses(sCell), `classes differ for col ${colId}`).toEqual(sortedClasses(vCell));
      expect((sCell as HTMLElement).style.width, `width differs for col ${colId}`).toBe(
        (vCell as HTMLElement).style.width,
      );
      expect(sCell.getAttribute("aria-sort"), `aria-sort differs for col ${colId}`).toBe(
        vCell.getAttribute("aria-sort"),
      );
      expect(sCell.getAttribute("role")).toBe("columnheader");
    }

    vanilla.destroy();
    unmount();
  });

  it("drains reactive columnDefs changes after ready: header updates via the whenReady/_processOnChange path", async () => {
    const [cols, setCols] = createSignal<ColDef<CarRow>[]>(columnDefs);
    const onGridReadySpy = vi.fn();
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={cols()}
        rowData={rowData}
        onGridReady={onGridReadySpy}
      />
    ));
    await waitFor(() => onGridReadySpy.mock.calls.length > 0);
    await waitFor(() => container.querySelectorAll(".ag-header-cell").length === 2);

    setCols([{ field: "make" }, { field: "price" }, { headerName: "Extra", colId: "extra" }]);
    await waitFor(() => container.querySelectorAll(".ag-header-cell").length === 3);

    const headerTexts = Array.from(container.querySelectorAll(".ag-header-cell-text")).map(
      (el) => el.textContent,
    );
    expect(headerTexts).toEqual(["Make", "Price", "Extra"]);

    unmount();
  });

  it("parity: header click sorting matches vanilla (column state + aria-sort indicator)", async () => {
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
    await waitFor(() => apiRef != null);
    await waitFor(() => container.querySelectorAll(".ag-header-cell-label").length === 2);
    await settle();

    const clickHeader = (root: Element, colId: string) => {
      const label = root.querySelector<HTMLElement>(
        `.ag-header-cell[col-id="${colId}"] .ag-header-cell-label`,
      )!;
      label.click();
    };

    // one click → ascending
    clickHeader(vanilla.container, "make");
    clickHeader(container, "make");
    await settle();

    const sortState = (
      state: { colId: string; sort?: string | null; sortIndex?: number | null }[],
    ) =>
      state
        .filter((s) => s.sort != null)
        .map(({ colId, sort, sortIndex }) => ({ colId, sort, sortIndex }));
    expect(sortState(apiRef!.api.getColumnState())).toEqual(
      sortState(vanilla.api.getColumnState()),
    );
    await waitFor(
      () =>
        container.querySelector('.ag-header-cell[col-id="make"]')?.getAttribute("aria-sort") ===
        "ascending",
    );

    // second click → descending, still matching vanilla
    clickHeader(vanilla.container, "make");
    clickHeader(container, "make");
    await settle();
    expect(sortState(apiRef!.api.getColumnState())).toEqual(
      sortState(vanilla.api.getColumnState()),
    );
    await waitFor(
      () =>
        container.querySelector('.ag-header-cell[col-id="make"]')?.getAttribute("aria-sort") ===
        "descending",
    );
    const vSort = vanilla.container
      .querySelector('.ag-header-cell[col-id="make"]')!
      .getAttribute("aria-sort");
    expect(vSort).toBe("descending");

    vanilla.destroy();
    unmount();
  });

  it("resizes a column by dragging the header resize handle", async () => {
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={[{ field: "make", resizable: true }, { field: "price" }]}
        rowData={rowData}
        ref={(r) => (apiRef = r)}
      />
    ));
    await waitFor(() => apiRef != null);
    await waitFor(() => container.querySelectorAll(".ag-header-cell").length === 2);
    await settle();

    const startWidth = apiRef!.api.getColumnState().find((s) => s.colId === "make")!.width!;

    const handle = container.querySelector<HTMLElement>(
      '.ag-header-cell[col-id="make"] .ag-header-cell-resize',
    )!;
    expect(handle).not.toBeNull();
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;

    const mouse = (target: EventTarget, type: string, x: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );

    mouse(handle, "mousedown", startX);
    // the drag service starts dragging only past its px threshold, so move in steps
    mouse(document, "mousemove", startX + 10);
    mouse(document, "mousemove", startX + 60);
    mouse(document, "mouseup", startX + 60);
    await settle();

    await waitFor(() => {
      const width = apiRef!.api.getColumnState().find((s) => s.colId === "make")!.width!;
      return width > startWidth;
    });
    const endWidth = apiRef!.api.getColumnState().find((s) => s.colId === "make")!.width!;
    expect(endWidth).toBeGreaterThan(startWidth);
    // the header cell element tracks the new width
    const headerWidth = container.querySelector<HTMLElement>('.ag-header-cell[col-id="make"]')!
      .style.width;
    expect(Number.parseFloat(headerWidth)).toBeCloseTo(endWidth, 0);

    unmount();
  });

  it("parity: no-rows overlay appears with empty rowData (overlay wrapper bean)", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData: [] };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={[]}
      />
    ));
    await waitFor(() => container.querySelector(".ag-overlay-no-rows-center") != null);

    const vOverlay = vanilla.container.querySelector(".ag-overlay-no-rows-center");
    const sOverlay = container.querySelector(".ag-overlay-no-rows-center");
    expect(vOverlay).not.toBeNull();
    expect(sOverlay).not.toBeNull();
    expect(sOverlay!.textContent).toBe(vOverlay!.textContent);
    // the overlay wrapper is appended to ag-root, like vanilla
    expect(container.querySelector(".ag-overlay")!.closest(".ag-root")).not.toBeNull();

    vanilla.destroy();
    unmount();
  });
});
