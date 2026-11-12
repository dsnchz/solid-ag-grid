// RUNTIME OPERATIONS PARITY: the same sequence of runtime API calls on a Solid grid and a vanilla
// createGrid, compared after every step by a DOM signature (header cells per lane with width,
// left and aria-sort — order-free, since the header row keeps React's DOM order; every row's
// per-lane cells with text; pinned rows; full-width content). Any uncaught error, error thrown
// by an API call, or error at unmount fails the run. Mount-time parity is covered elsewhere;
// this is where comps meet ctrls the core hands over, moves or rebuilds while the grid lives.
// Before src/core/compClaim.ts, column moves, group open/close, columnDefs swaps and pinning
// threw TypeErrors here (a header ctrl handed to a new comp was cleared by the old one).
import { render } from "@solidjs/testing-library";
import type { ColDef, ColGroupDef, GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { expect, it } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; make: string; model: string; price: number; year: number };
const makeRows = (n: number, offset = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i + offset}`,
    make: `M${(i + offset) % 5}`,
    model: `X${i + offset}`,
    price: ((i + offset) * 37) % 1000,
    year: 2000 + ((i + offset) % 20),
  }));
const settle = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

const defs = (): (ColDef<Row> | ColGroupDef<Row>)[] => [
  { field: "make" },
  {
    headerName: "Car",
    groupId: "car",
    children: [
      { field: "model" },
      { field: "price", columnGroupShow: "open" },
      { field: "year", columnGroupShow: "open" },
    ],
  },
];

/** Header col-ids per lane + every row's per-lane cell col-ids and text, by row-index. */
const signature = (root: Element) => {
  const lanes = [
    ".ag-grid-pinned-left-cells",
    ".ag-grid-scrolling-cells",
    ".ag-grid-pinned-right-cells",
  ];
  const header = Array.from(root.querySelectorAll(".ag-header-row")).map((hr) =>
    lanes.map((l) =>
      Array.from(hr.querySelectorAll(`${l} [col-id]`))
        .map(
          (c) =>
            `${c.getAttribute("col-id")}|${(c as HTMLElement).style.width}|${(c as HTMLElement).style.left}|${c.getAttribute("aria-sort") ?? ""}`,
        )
        .sort(),
    ),
  );
  const rows = Array.from(root.querySelectorAll<HTMLElement>(".ag-row"))
    .filter((r) => r.closest(".ag-floating-top, .ag-floating-bottom") == null)
    .map((r) => ({
      i: Number(r.getAttribute("row-index")),
      cells: lanes.map((l) =>
        Array.from(r.querySelectorAll(`${l} .ag-cell`)).map(
          (c) => `${c.getAttribute("col-id")}=${c.textContent}`,
        ),
      ),
      fullWidth:
        r.querySelector(".ag-full-width-anchor, .ag-full-width-container")?.textContent ?? null,
    }))
    .sort((a, b) => a.i - b.i);
  const pinned = (sel: string) =>
    Array.from(root.querySelectorAll(`${sel} .ag-row`)).map((r) =>
      Array.from(r.querySelectorAll(".ag-cell"))
        .map((c) => c.textContent)
        .join(","),
    );
  return {
    header,
    rows,
    pinnedTop: pinned(".ag-floating-top"),
    pinnedBottom: pinned(".ag-floating-bottom"),
  };
};

const mountPair = async (
  options: GridOptions<Row>,
  solidOverrides: Partial<GridOptions<Row>> = {},
) => {
  const vc = document.createElement("div");
  vc.style.cssText = "height:400px;width:900px";
  document.body.appendChild(vc);
  const vapi = createGrid(vc, options);
  let sapi: GridApi<Row> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "400px", width: "900px" }}
      {...options}
      {...solidOverrides}
      ref={(r: AgGridSolidRef<Row>) => (sapi = r.api)}
    />
  ));
  while (!sapi || !rendered.container.querySelector(".ag-row .ag-cell")) await settle(10);
  await settle();
  return { vc, vapi, sapi: sapi!, container: rendered.container, unmount: rendered.unmount };
};

type Step = [label: string, op: (api: GridApi<Row>) => void];

/**
 * Runs each step on both grids, waits until the two DOM signatures agree (or 2 s pass), then
 * asserts they agree. Uncaught errors, errors thrown by an API call, and errors thrown at
 * unmount all fail the run.
 */
const runSweep = async (
  options: GridOptions<Row>,
  steps: Step[],
  solidOverrides: Partial<GridOptions<Row>> = {},
) => {
  const errors: string[] = [];
  const onErr = (e: ErrorEvent) => errors.push(e.message);
  window.addEventListener("error", onErr);
  const g = await mountPair(options, solidOverrides);
  try {
    for (const [label, op] of steps) {
      op(g.vapi);
      try {
        op(g.sapi);
      } catch (e) {
        errors.push(`${label}: ${String(e)}`);
      }
      const v = () => JSON.stringify(signature(g.vc));
      const s = () => JSON.stringify(signature(g.container));
      const start = Date.now();
      while (v() !== s() && Date.now() - start < 2000) {
        await settle(20);
      }
      expect(signature(g.container), label).toEqual(signature(g.vc));
    }
  } finally {
    g.vapi.destroy();
    g.vc.remove();
    try {
      g.unmount();
    } catch (e) {
      errors.push(`unmount: ${String(e)}`);
    }
    await settle(30);
    window.removeEventListener("error", onErr);
  }
  expect(errors).toEqual([]);
};

const resize = (key: string, w: number): Step => [
  `resize ${key} ${w}`,
  (a) => a.setColumnWidths([{ key, newWidth: w }]),
];
const sort = (colId: string, dir: "asc" | "desc" | null): Step => [
  `sort ${colId} ${dir}`,
  (a) => a.applyColumnState({ state: [{ colId, sort: dir }], defaultState: { sort: null } }),
];

it("columns: move, hide/show, group open/close, pin, resize, sort", async () => {
  await runSweep(
    {
      columnDefs: defs(),
      rowData: makeRows(30),
      getRowId: (p) => p.data.id,
      defaultColDef: { filter: true, floatingFilter: true },
    },
    [
      ["open group", (a) => a.setColumnGroupOpened("car", true)],
      resize("price", 150),
      ["move price to 0", (a) => a.moveColumns(["price"], 0)],
      sort("price", "desc"),
      ["hide model", (a) => a.setColumnsVisible(["model"], false)],
      ["pin year left", (a) => a.applyColumnState({ state: [{ colId: "year", pinned: "left" }] })],
      ["close group", (a) => a.setColumnGroupOpened("car", false)],
      ["show model", (a) => a.setColumnsVisible(["model"], true)],
      ["open group again", (a) => a.setColumnGroupOpened("car", true)],
      ["unpin year", (a) => a.applyColumnState({ state: [{ colId: "year", pinned: null }] })],
      resize("year", 133),
      sort("year", "asc"),
      [
        "pin make right",
        (a) => a.applyColumnState({ state: [{ colId: "make", pinned: "right" }] }),
      ],
      ["move make to 0 (still pinned)", (a) => a.moveColumns(["make"], 0)],
      ["reset column state", (a) => a.resetColumnState()],
      resize("make", 99),
      sort("make", "desc"),
    ],
  );
});

it("columnDefs replacement: add, remove, reorder, change group", async () => {
  const swaps: (ColDef<Row> | ColGroupDef<Row>)[][] = [
    [{ field: "model" }, { field: "make" }],
    [{ field: "make", pinned: "left" }, { field: "price" }, { field: "year", pinned: "right" }],
    [{ headerName: "G2", children: [{ field: "year" }, { field: "make" }] }, { field: "model" }],
    defs(),
  ];
  await runSweep({ columnDefs: defs(), rowData: makeRows(20), getRowId: (p) => p.data.id }, [
    ...swaps.flatMap((d, i): Step[] => [
      [`columnDefs swap ${i}`, (a) => a.setGridOption("columnDefs", d)],
      resize(i === 2 ? "year" : "make", 120 + i),
      sort(i === 2 ? "year" : "make", i % 2 ? "asc" : "desc"),
    ]),
  ]);
});

it("rows: pinned rows, rowData swaps, pagination, filter, row height, domLayout", async () => {
  await runSweep(
    {
      columnDefs: defs(),
      rowData: makeRows(60),
      getRowId: (p) => p.data.id,
      defaultColDef: { filter: true },
    },
    [
      ["pinned top 2", (a) => a.setGridOption("pinnedTopRowData", makeRows(2, 900))],
      ["pinned bottom 1", (a) => a.setGridOption("pinnedBottomRowData", makeRows(1, 950))],
      ["rowData shift", (a) => a.setGridOption("rowData", makeRows(60, 5))],
      ["pin year left", (a) => a.applyColumnState({ state: [{ colId: "year", pinned: "left" }] })],
      ["clear pinned top", (a) => a.setGridOption("pinnedTopRowData", [])],
      ["pagination on", (a) => a.setGridOption("pagination", true)],
      ["page size 10", (a) => a.setGridOption("paginationPageSize", 10)],
      ["next page", (a) => a.paginationGoToNextPage()],
      [
        "filter make M1",
        (a) => a.setFilterModel({ make: { filterType: "text", type: "equals", filter: "M1" } }),
      ],
      ["clear filter", (a) => a.setFilterModel(null)],
      ["pagination off", (a) => a.setGridOption("pagination", false)],
      ["row height 50", (a) => a.setGridOption("rowHeight", 50)],
      ["domLayout autoHeight", (a) => a.setGridOption("domLayout", "autoHeight")],
      ["domLayout normal", (a) => a.setGridOption("domLayout", "normal")],
      ["unpin year", (a) => a.applyColumnState({ state: [{ colId: "year", pinned: null }] })],
      ["scroll to 55", (a) => a.ensureIndexVisible(55)],
      ["rowData shrink", (a) => a.setGridOption("rowData", makeRows(5))],
      resize("model", 140),
      sort("model", "desc"),
    ],
  );
});

it("full-width rows, refresh, redraw, autosize, spans", async () => {
  await runSweep(
    {
      columnDefs: [
        { field: "make", colSpan: (p) => (p.data?.make === "M2" ? 2 : 1) },
        { field: "model" },
        { field: "price" },
        { field: "year" },
      ],
      rowData: makeRows(20),
      getRowId: (p) => p.data.id,
      isFullWidthRow: (p) => p.rowNode.data?.make === "M3",
      fullWidthCellRenderer: (p: { data?: Row }) => `FULL ${p.data?.model}`,
    },
    [
      ["refresh force", (a) => a.refreshCells({ force: true })],
      ["redraw rows", (a) => a.redrawRows()],
      [
        "update a full-width row's data",
        (a) => a.applyTransaction({ update: [{ ...makeRows(4)[3]!, model: "Z3" }] }),
      ],
      [
        "make r1 full width",
        (a) => a.applyTransaction({ update: [{ ...makeRows(2)[1]!, make: "M3" }] }),
      ],
      ["redraw r1", (a) => a.redrawRows({ rowNodes: [a.getRowNode("r1")!] })],
      [
        "pin price right",
        (a) => a.applyColumnState({ state: [{ colId: "price", pinned: "right" }] }),
      ],
      ["autosize all", (a) => a.autoSizeAllColumns()],
      ["size to fit", (a) => a.sizeColumnsToFit()],
      ["unpin price", (a) => a.applyColumnState({ state: [{ colId: "price", pinned: null }] })],
      resize("model", 160),
      sort("price", "asc"),
    ],
    { fullWidthCellRenderer: (p: { data?: Row }) => <>FULL {p.data?.model}</> },
  );
});

it("wide virtualised grid, selection, editing while pinning, runtime header options", async () => {
  const wideDefs: ColDef<Row>[] = [
    { field: "make", checkboxSelection: true, headerCheckboxSelection: true, editable: true },
    ...Array.from({ length: 60 }, (_, i): ColDef<Row> => ({
      colId: `c${i}`,
      headerName: `C${i}`,
      valueGetter: (p) => `${p.data?.model}-${i}`,
    })),
    { field: "price", editable: true },
  ];
  await runSweep(
    {
      columnDefs: wideDefs,
      rowData: makeRows(40),
      getRowId: (p) => p.data.id,
      rowSelection: "multiple",
    },
    [
      [
        "select r1,r2",
        (a) => {
          a.getRowNode("r1")?.setSelected(true);
          a.getRowNode("r2")?.setSelected(true);
        },
      ],
      ["scroll right", (a) => a.ensureColumnVisible("c45")],
      ["pin c45 left", (a) => a.applyColumnState({ state: [{ colId: "c45", pinned: "left" }] })],
      ["start editing price r0", (a) => a.startEditingCell({ rowIndex: 0, colKey: "price" })],
      [
        "pin price right while editing",
        (a) => a.applyColumnState({ state: [{ colId: "price", pinned: "right" }] }),
      ],
      ["stop editing", (a) => a.stopEditing(true)],
      [
        "pin make right (checkbox cells move lanes)",
        (a) => a.applyColumnState({ state: [{ colId: "make", pinned: "right" }] }),
      ],
      ["select r3", (a) => a.getRowNode("r3")?.setSelected(true)],
      ["move c3 to 1", (a) => a.moveColumns(["c3"], 1)],
      ["scroll left", (a) => a.ensureColumnVisible("c0")],
      ["unpin all", (a) => a.applyColumnState({ defaultState: { pinned: null } })],
      [
        "floating filters on",
        (a) => a.setGridOption("defaultColDef", { filter: true, floatingFilter: true }),
      ],
      ["header height 60", (a) => a.setGridOption("headerHeight", 60)],
      [
        "floating filters off",
        (a) => a.setGridOption("defaultColDef", { filter: true, floatingFilter: false }),
      ],
      ["deselect all", (a) => a.deselectAll()],
      ["rowSelection single", (a) => a.setGridOption("rowSelection", "single")],
      resize("make", 222),
      sort("price", "desc"),
    ],
  );
});
