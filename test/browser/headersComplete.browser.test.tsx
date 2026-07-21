// T3.9 parity oracle: complete headers — group header cells (expand/collapse, spanning,
// pinned lanes), floating filter row (built-in text floating filter + custom Solid floating
// filter through FloatingFilterComponentProxy), custom Solid header components, innerHeader,
// and user headerStyle with camelCase keys. Every scenario compares against vanilla
// createGrid with identical colDefs where a vanilla equivalent exists.
import { render } from "@solidjs/testing-library";
import type { ColDef, ColGroupDef, GridApi, GridOptions, IHeaderParams } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type {
  AgGridSolidRef,
  CustomFloatingFilterProps,
  CustomInnerHeaderProps,
} from "../../src/index";
import AgGridSolid, { useGridFloatingFilter } from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  model: string;
  price: number;
}

const rowData = (): CarRow[] => [
  { make: "Toyota", model: "Celica", price: 35000 },
  { make: "Ford", model: "Mondeo", price: 32000 },
  { make: "Porsche", model: "Boxster", price: 72000 },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const mountVanilla = <TData,>(options: GridOptions<TData>) => {
  const container = document.createElement("div");
  container.style.height = "400px";
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
      containerStyle={{ height: "400px", width: "600px" }}
      {...props}
      ref={(r: AgGridSolidRef<TData>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<TData> | undefined };
};

const sortedClasses = (el: Element) => Array.from(el.classList).sort();

const displayedMakes = (container: Element) =>
  Array.from(container.querySelectorAll('.ag-cell[col-id="make"]')).map((cell) => cell.textContent);

const groupedColumnDefs: (ColDef<CarRow> | ColGroupDef<CarRow>)[] = [
  {
    headerName: "Car",
    groupId: "car",
    children: [{ field: "make" }, { field: "model", columnGroupShow: "open" }],
  },
  { field: "price" },
];

describe("Headers complete (browser)", () => {
  it("parity: 2-level column group headers match vanilla — structure, spanning widths, expand/collapse via click, aria-expanded", async () => {
    const options: GridOptions<CarRow> = { columnDefs: groupedColumnDefs, rowData: rowData() };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);
    await waitFor(() => solid.container.querySelector(".ag-header-group-cell") != null);
    await settle();

    // two header rows: group row + column row
    expect(solid.container.querySelectorAll(".ag-header-row").length).toBe(
      vanilla.container.querySelectorAll(".ag-header-row").length,
    );

    const groupCellOf = (root: Element) =>
      root.querySelector<HTMLElement>('.ag-header-group-cell[col-id^="car"]')!;
    const vGroup = groupCellOf(vanilla.container);
    const sGroup = groupCellOf(solid.container);
    expect(sortedClasses(sGroup)).toEqual(sortedClasses(vGroup));
    expect(sGroup.getAttribute("aria-expanded")).toBe("false");
    expect(sGroup.getAttribute("aria-expanded")).toBe(vGroup.getAttribute("aria-expanded"));
    expect(sGroup.style.width).toBe(vGroup.style.width);

    // collapsed: group spans only `make` (compare as sets — the wrapper preserves DOM order of
    // surviving cells via getNextValueIfDifferent, so DOM order may lag vanilla's; display
    // order is asserted through the api below)
    const headerCells = (root: Element) =>
      Array.from(root.querySelectorAll(".ag-header-cell:not(.ag-floating-filter)"))
        .map((cell) => cell.getAttribute("col-id"))
        .sort();
    const displayedCols = (api: GridApi<CarRow>) =>
      api.getAllDisplayedColumns().map((col) => col.getColId());
    expect(headerCells(solid.container)).toEqual(headerCells(vanilla.container));
    expect(headerCells(solid.container)).toEqual(["make", "price"]);
    expect(displayedCols(solid.api()!)).toEqual(displayedCols(vanilla.api));

    // expand via the expand icon click, both grids
    const expandIcon = (root: Element) =>
      groupCellOf(root).querySelector<HTMLElement>(".ag-header-expand-icon:not(.ag-hidden)")!;
    expandIcon(vanilla.container).click();
    expandIcon(solid.container).click();
    await waitFor(() => headerCells(solid.container).length === 3);
    await waitFor(() => headerCells(vanilla.container).length === 3);
    await settle();

    expect(headerCells(solid.container)).toEqual(headerCells(vanilla.container));
    expect(displayedCols(solid.api()!)).toEqual(displayedCols(vanilla.api));
    expect(groupCellOf(solid.container).getAttribute("aria-expanded")).toBe("true");
    expect(groupCellOf(solid.container).getAttribute("aria-expanded")).toBe(
      groupCellOf(vanilla.container).getAttribute("aria-expanded"),
    );

    // expanded group spans make + model: width equals the sum of its children, matching vanilla
    const widthOf = (root: Element, colId: string) =>
      root.querySelector<HTMLElement>(`.ag-header-cell[col-id="${colId}"]`)!.getBoundingClientRect()
        .width;
    const sGroupExpanded = groupCellOf(solid.container);
    const vGroupExpanded = groupCellOf(vanilla.container);
    expect(sGroupExpanded.style.width).toBe(vGroupExpanded.style.width);
    const expectedSpan = () => widthOf(solid.container, "make") + widthOf(solid.container, "model");
    // the theme animates header cell widths — wait for the transitions to finish, then assert
    // the group spans its children (sub-pixel tolerance) and matches vanilla exactly
    await waitFor(
      () =>
        Math.abs(sGroupExpanded.getBoundingClientRect().width - expectedSpan()) < 1 &&
        Math.abs(
          sGroupExpanded.getBoundingClientRect().width -
            vGroupExpanded.getBoundingClientRect().width,
        ) < 0.5,
    );
    expect(Math.abs(sGroupExpanded.getBoundingClientRect().width - expectedSpan())).toBeLessThan(1);
    expect(sGroupExpanded.getBoundingClientRect().width).toBeCloseTo(
      vGroupExpanded.getBoundingClientRect().width,
      0,
    );

    // group resize handle visibility matches vanilla (setResizableDisplayed)
    const resizeHandle = (root: Element) =>
      groupCellOf(root).querySelector<HTMLElement>(".ag-header-cell-resize")!;
    expect(sortedClasses(resizeHandle(solid.container))).toEqual(
      sortedClasses(resizeHandle(vanilla.container)),
    );
    expect(resizeHandle(solid.container).getAttribute("aria-hidden")).toBe(
      resizeHandle(vanilla.container).getAttribute("aria-hidden"),
    );

    // collapse again — children hide like vanilla
    expandIcon(vanilla.container).click();
    expandIcon(solid.container).click();
    await waitFor(() => headerCells(solid.container).length === 2);
    expect(headerCells(solid.container)).toEqual(headerCells(vanilla.container));
    expect(groupCellOf(solid.container).getAttribute("aria-expanded")).toBe("false");

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: keyboard header navigation — ArrowRight moves header focus, Enter sorts, matching vanilla", async () => {
    const columnDefs: ColDef<CarRow>[] = [
      { field: "make" },
      { field: "model" },
      { field: "price" },
    ];
    const options: GridOptions<CarRow> = { columnDefs, rowData: rowData() };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);
    await waitFor(() => solid.container.querySelectorAll(".ag-header-cell").length === 3);
    await settle();

    const keydown = (key: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    const focusedColId = () =>
      (document.activeElement as HTMLElement | null)?.getAttribute("col-id");

    const run = async (root: Element, api: GridApi<CarRow>) => {
      // focus the first header cell through the grid's focus service
      api.setFocusedHeader("make");
      await waitFor(() => focusedColId() === "make");
      expect(root.contains(document.activeElement)).toBe(true);

      keydown("ArrowRight");
      await waitFor(() => focusedColId() === "model");

      keydown("ArrowRight");
      await waitFor(() => focusedColId() === "price");

      keydown("ArrowLeft");
      await waitFor(() => focusedColId() === "model");

      // Enter sorts the focused column
      keydown("Enter");
      await waitFor(() => api.getColumnState().find((s) => s.colId === "model")?.sort === "asc");
      return api.getColumnState().map(({ colId, sort }) => ({ colId, sort: sort ?? null }));
    };

    const vanillaResult = await run(vanilla.container, vanilla.api);
    const solidResult = await run(solid.container, solid.api()!);
    expect(solidResult).toEqual(vanillaResult);

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: pinned columns + groups — header lane widths match vanilla across group, column and filter rows", async () => {
    const columnDefs: (ColDef<CarRow> | ColGroupDef<CarRow>)[] = [
      {
        headerName: "Car",
        groupId: "car",
        children: [
          { field: "make", pinned: "left", filter: "agTextColumnFilter", floatingFilter: true },
          { field: "model" },
        ],
      },
      { field: "price", pinned: "right" },
    ];
    const options: GridOptions<CarRow> = { columnDefs, rowData: rowData() };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);
    await waitFor(() => solid.container.querySelector(".ag-header-row-filter") != null);
    await settle();

    const vRows = Array.from(vanilla.container.querySelectorAll(".ag-header-row"));
    const sRows = Array.from(solid.container.querySelectorAll(".ag-header-row"));
    expect(sRows.length).toBe(vRows.length);
    expect(sRows.length).toBe(3); // group + column + filter

    for (let i = 0; i < vRows.length; i++) {
      for (const lane of [
        ".ag-grid-pinned-left-cells",
        ".ag-grid-scrolling-cells",
        ".ag-grid-pinned-right-cells",
      ]) {
        const vLane = vRows[i]!.querySelector<HTMLElement>(lane)!;
        const sLane = sRows[i]!.querySelector<HTMLElement>(lane)!;
        expect(sLane.style.width, `row ${i} lane ${lane} width`).toBe(vLane.style.width);
        expect(
          sLane.getBoundingClientRect().width,
          `row ${i} lane ${lane} layout width`,
        ).toBeCloseTo(vLane.getBoundingClientRect().width, 0);
      }
    }

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: built-in floating filter row — typing filters rows identically to vanilla; the filter button opens the column filter", async () => {
    const columnDefs: ColDef<CarRow>[] = [
      {
        field: "make",
        filter: "agTextColumnFilter",
        floatingFilter: true,
        filterParams: { debounceMs: 0 },
      },
      { field: "price" },
    ];
    const options: GridOptions<CarRow> = { columnDefs, rowData: rowData() };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);

    const floatingInput = (root: Element) =>
      root.querySelector<HTMLInputElement>('.ag-floating-filter[col-id="make"] input')!;
    await waitFor(() => floatingInput(solid.container) != null);
    await waitFor(() => floatingInput(vanilla.container) != null);
    await settle();

    // floating filter cell structure parity
    const vCell = vanilla.container.querySelector('.ag-floating-filter[col-id="make"]')!;
    const sCell = solid.container.querySelector('.ag-floating-filter[col-id="make"]')!;
    expect(sortedClasses(sCell)).toEqual(sortedClasses(vCell));
    expect(sCell.getAttribute("role")).toBe(vCell.getAttribute("role"));

    // typing in the floating input filters end-to-end, identical visible sets
    // ("or" matches Ford + Porsche, not Toyota)
    await userEvent.fill(floatingInput(vanilla.container), "or");
    await userEvent.fill(floatingInput(solid.container), "or");
    await waitFor(() => solid.api()!.getDisplayedRowCount() < 3);
    await waitFor(() => vanilla.api.getDisplayedRowCount() < 3);
    expect(solid.api()!.getDisplayedRowCount()).toBe(vanilla.api.getDisplayedRowCount());
    expect(displayedMakes(solid.container)).toEqual(displayedMakes(vanilla.container));
    expect(await solid.api()!.getColumnFilterModel("make")).toEqual(
      await vanilla.api.getColumnFilterModel("make"),
    );

    // narrow further from the floating input
    await userEvent.fill(
      solid.container.querySelector<HTMLInputElement>('.ag-floating-filter[col-id="make"] input')!,
      "Toy",
    );
    await waitFor(() => displayedMakes(solid.container).join() === "Toyota");

    // the filter button opens the column filter popup
    solid.container
      .querySelector<HTMLElement>(
        '.ag-floating-filter[col-id="make"] .ag-floating-filter-button-button',
      )!
      .click();
    await waitFor(() => solid.container.querySelector(".ag-filter") != null);
    expect(solid.container.querySelector(".ag-filter")).not.toBeNull();

    vanilla.destroy();
    solid.unmount();
  });

  it("custom Solid floating filter (reactive proxy + useGridFloatingFilter): floating edit filters rows (updateFloatingFilterParent), parent model changes sync back to the floating display", async () => {
    const afterGuiAttachedSpy = vi.fn();
    const SolidFloatingFilter = (props: CustomFloatingFilterProps<CarRow>) => {
      // exercises CustomContext → proxy.setMethods through the inline (portal-free) render path
      useGridFloatingFilter({ afterGuiAttached: afterGuiAttachedSpy });
      return (
        <input
          class="solid-floating-input"
          value={(props.model as { filter?: string } | null)?.filter ?? ""}
          onInput={(e) => {
            const value = e.currentTarget.value;
            props.onModelChange(
              value === "" ? null : { filterType: "text", type: "contains", filter: value },
            );
          }}
        />
      );
    };

    const columnDefs: ColDef<CarRow>[] = [
      {
        field: "make",
        filter: "agTextColumnFilter",
        floatingFilter: true,
        floatingFilterComponent: SolidFloatingFilter,
        filterParams: { debounceMs: 0 },
      },
      { field: "price" },
    ];
    const solid = mountSolid<CarRow>({ columnDefs, rowData: rowData() });

    await waitFor(() => solid.container.querySelector(".solid-floating-input") != null);
    const input = () => solid.container.querySelector<HTMLInputElement>(".solid-floating-input")!;

    // floating edit → parent: updateFloatingFilterParent pushes the model into the column
    // filter and calls filterChangedCallback, so rows actually filter
    await userEvent.fill(input(), "Ford");
    await waitFor(() => displayedMakes(solid.container).join() === "Ford");
    expect(await solid.api()!.getColumnFilterModel("make")).toEqual({
      filterType: "text",
      type: "contains",
      filter: "Ford",
    });

    // parent → floating: setting the parent filter model updates the floating display
    // (ctrl → getFloatingFilterComp promise → proxy.onParentModelChanged → props push)
    await solid.api()!.setColumnFilterModel("make", {
      filterType: "text",
      type: "contains",
      filter: "Porsche",
    });
    solid.api()!.onFilterChanged();
    await waitFor(() => input().value === "Porsche");
    await waitFor(() => displayedMakes(solid.container).join() === "Porsche");

    // clearing the parent model empties the floating display
    await solid.api()!.setColumnFilterModel("make", null);
    solid.api()!.onFilterChanged();
    await waitFor(() => input().value === "");
    await waitFor(() => displayedMakes(solid.container).length === 3);

    solid.unmount();
  });

  it("custom Solid header component receives IHeaderParams and cycles sort via progressSort; DOM identity is preserved across a column move", async () => {
    const SortingHeader = (props: IHeaderParams<CarRow>) => (
      <button class="solid-sort-header" type="button" onClick={() => props.progressSort()}>
        {props.displayName}
      </button>
    );
    const columnDefs: ColDef<CarRow>[] = [
      { field: "make", headerComponent: SortingHeader },
      { field: "price" },
    ];
    const solid = mountSolid<CarRow>({ columnDefs, rowData: rowData() });

    await waitFor(() => solid.container.querySelector(".solid-sort-header") != null);
    const headerButton = () => solid.container.querySelector<HTMLElement>(".solid-sort-header")!;
    expect(headerButton().textContent).toBe("Make");

    const sortOf = () =>
      solid
        .api()!
        .getColumnState()
        .find((s) => s.colId === "make")!.sort;

    // progressSort cycles asc → desc → none, and the ctrl pushes aria-sort onto the cell
    headerButton().click();
    await waitFor(() => sortOf() === "asc");
    await waitFor(
      () =>
        solid.container
          .querySelector('.ag-header-cell[col-id="make"]')!
          .getAttribute("aria-sort") === "ascending",
    );
    // display order via the api (row DOM order is identity-stable, not display-ordered)
    const displayedOrder = () => {
      const api = solid.api()!;
      return Array.from(
        { length: api.getDisplayedRowCount() },
        (_, i) => api.getDisplayedRowAtIndex(i)!.data!.make,
      );
    };
    await waitFor(() => displayedOrder().join() === "Ford,Porsche,Toyota");

    headerButton().click();
    await waitFor(() => sortOf() === "desc");

    headerButton().click();
    await waitFor(() => sortOf() == null);

    // moving a column keeps existing header cell elements (identity preserved through the
    // setHeaderCtrls diff — like React v36, the section signature includes ctrl order, so the
    // DOM order follows the new column order while the elements themselves are reused)
    const makeCellBefore = solid.container.querySelector('.ag-header-cell[col-id="make"]')!;
    const priceCellBefore = solid.container.querySelector('.ag-header-cell[col-id="price"]')!;
    solid.api()!.moveColumns(["price"], 0);
    await settle();
    await waitFor(
      () =>
        solid
          .api()!
          .getColumnState()
          .map((s) => s.colId)
          .join() === "price,make",
    );
    await settle();
    expect(solid.container.querySelector('.ag-header-cell[col-id="make"]')).toBe(makeCellBefore);
    expect(solid.container.querySelector('.ag-header-cell[col-id="price"]')).toBe(priceCellBefore);

    solid.unmount();
  });

  it("innerHeader: a Solid innerHeaderComponent renders inside the default header comp (sort furniture intact)", async () => {
    const InnerHeader = (props: CustomInnerHeaderProps<CarRow>) => (
      <span class="solid-inner-header">[{props.displayName}]</span>
    );
    const columnDefs: ColDef<CarRow>[] = [
      { field: "make", headerComponentParams: { innerHeaderComponent: InnerHeader } },
      { field: "price" },
    ];
    const solid = mountSolid<CarRow>({ columnDefs, rowData: rowData() });

    await waitFor(() => solid.container.querySelector(".solid-inner-header") != null);
    const inner = solid.container.querySelector(".solid-inner-header")!;
    expect(inner.textContent).toBe("[Make]");
    // rendered inside the default header comp's label, not replacing it
    expect(inner.closest(".ag-header-cell-label")).not.toBeNull();
    expect(inner.closest('.ag-header-cell[col-id="make"]')).not.toBeNull();
    // default header sorting still works around the inner header
    solid.container
      .querySelector<HTMLElement>('.ag-header-cell[col-id="make"] .ag-header-cell-label')!
      .click();
    await waitFor(
      () =>
        solid
          .api()!
          .getColumnState()
          .find((s) => s.colId === "make")!.sort === "asc",
    );

    solid.unmount();
  });

  it("parity: headerStyle with camelCase keys applies to header, group and floating filter cells like vanilla", async () => {
    const columnDefs: (ColDef<CarRow> | ColGroupDef<CarRow>)[] = [
      {
        headerName: "Car",
        groupId: "car",
        headerStyle: { backgroundColor: "rgb(10, 20, 30)" },
        children: [
          {
            field: "make",
            headerStyle: { backgroundColor: "rgb(40, 50, 60)", fontStyle: "italic" },
            filter: "agTextColumnFilter",
            floatingFilter: true,
          },
        ],
      },
      { field: "price" },
    ];
    const options: GridOptions<CarRow> = { columnDefs, rowData: rowData() };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);
    await waitFor(() => solid.container.querySelector(".ag-header-row-filter") != null);
    await settle();

    const compare = (selector: string, cssProp: string, expected: string) => {
      const vEl = vanilla.container.querySelector<HTMLElement>(selector)!;
      const sEl = solid.container.querySelector<HTMLElement>(selector)!;
      const vValue = getComputedStyle(vEl).getPropertyValue(cssProp);
      const sValue = getComputedStyle(sEl).getPropertyValue(cssProp);
      expect(sValue, `${selector} ${cssProp}`).toBe(vValue);
      expect(sValue, `${selector} ${cssProp}`).toBe(expected);
    };

    compare('.ag-header-group-cell[col-id^="car"]', "background-color", "rgb(10, 20, 30)");
    compare(
      '.ag-header-cell[col-id="make"]:not(.ag-floating-filter)',
      "background-color",
      "rgb(40, 50, 60)",
    );
    compare('.ag-header-cell[col-id="make"]:not(.ag-floating-filter)', "font-style", "italic");
    compare('.ag-floating-filter[col-id="make"]', "background-color", "rgb(40, 50, 60)");

    vanilla.destroy();
    solid.unmount();
  });
});
