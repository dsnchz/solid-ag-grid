// T3.9 shell contract (jsdom): the real HeaderGroupCellComp / HeaderFilterCellComp render for
// 'group' / 'filter' header rows (the T3.3 temporary HeaderCellComp cast is gone), and user
// headerStyle camelCase keys apply to the header cell element.
import { render } from "@solidjs/testing-library";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  model: string;
  price: number;
}

const rowData: CarRow[] = [
  { make: "Toyota", model: "Celica", price: 35000 },
  { make: "Ford", model: "Mondeo", price: 32000 },
];

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

describe("Headers complete (jsdom shell contract)", () => {
  it("renders real group header cells for 'group' rows (not the default HeaderCellComp)", async () => {
    const columnDefs: (ColDef<CarRow> | ColGroupDef<CarRow>)[] = [
      {
        headerName: "Car",
        groupId: "car",
        children: [{ field: "make" }, { field: "model", columnGroupShow: "open" }],
      },
      { field: "price" },
    ];
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));

    await waitFor(() => container.querySelector(".ag-header-group-cell") != null);
    // group col-ids are instance-suffixed (car_0)
    const groupCell = container.querySelector<HTMLElement>('.ag-header-group-cell[col-id^="car"]')!;
    expect(groupCell).not.toBeNull();
    expect(groupCell.getAttribute("role")).toBe("columnheader");
    // expandable group carries aria-expanded (HeaderGroupCellComp signal, default comp wired)
    expect(groupCell.getAttribute("aria-expanded")).toBe("false");
    // comp wrapper + resize handle structure matches the ported skeleton
    expect(groupCell.querySelector(".ag-header-cell-comp-wrapper")).not.toBeNull();
    expect(groupCell.querySelector(".ag-header-cell-resize")).not.toBeNull();

    unmount();
  });

  it("renders real floating filter cells for 'filter' rows (role gridcell, body + button wrapper)", async () => {
    const columnDefs: ColDef<CarRow>[] = [
      { field: "make", filter: "agTextColumnFilter", floatingFilter: true },
      { field: "price" },
    ];
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));

    await waitFor(() => container.querySelector(".ag-floating-filter") != null);
    const filterCell = container.querySelector<HTMLElement>('.ag-floating-filter[col-id="make"]')!;
    // the T3.3 temporary cast rendered role="columnheader" default cells; the real comp is a
    // gridcell with the floating filter body + button wrapper skeleton
    expect(filterCell.getAttribute("role")).toBe("gridcell");
    expect(filterCell.querySelector(".ag-floating-filter-button-button")).not.toBeNull();
    // built-in text floating filter (JS comp) mounts into the body via showJsComp
    await waitFor(() => filterCell.querySelector(".ag-floating-filter-input") != null);
    expect(filterCell.querySelector("input")).not.toBeNull();

    // the price column has no filter: its floating filter cell renders but stays empty
    const emptyCell = container.querySelector<HTMLElement>('.ag-floating-filter[col-id="price"]')!;
    expect(emptyCell).not.toBeNull();

    unmount();
  });

  it("applies user headerStyle with camelCase keys to header and group cells", async () => {
    const columnDefs: (ColDef<CarRow> | ColGroupDef<CarRow>)[] = [
      {
        headerName: "Car",
        groupId: "car",
        headerStyle: { backgroundColor: "rgb(1, 2, 3)" },
        children: [
          {
            field: "make",
            headerStyle: { backgroundColor: "rgb(4, 5, 6)" },
            filter: "agTextColumnFilter",
            floatingFilter: true,
          },
        ],
      },
    ];
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));

    await waitFor(() => container.querySelector(".ag-floating-filter") != null);
    const groupCell = container.querySelector<HTMLElement>('.ag-header-group-cell[col-id^="car"]')!;
    const headerCell = container.querySelector<HTMLElement>(
      '.ag-header-cell[col-id="make"]:not(.ag-floating-filter)',
    )!;
    const filterCell = container.querySelector<HTMLElement>('.ag-floating-filter[col-id="make"]')!;
    // camelCase keys must land as real CSS (kebab via style.setProperty) — a plain Solid style
    // object would silently drop them
    expect(groupCell.style.getPropertyValue("background-color")).toBe("rgb(1, 2, 3)");
    expect(headerCell.style.getPropertyValue("background-color")).toBe("rgb(4, 5, 6)");
    // vanilla applies headerStyle to the floating filter cell as well
    expect(filterCell.style.getPropertyValue("background-color")).toBe("rgb(4, 5, 6)");

    unmount();
  });
});
