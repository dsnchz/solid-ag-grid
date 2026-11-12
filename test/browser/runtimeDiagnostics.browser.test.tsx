// RUNTIME DIAGNOSTICS GUARD: the grid's realistic paths emit no Solid dev diagnostic. Solid's dev
// build reports reactivity mistakes the engine can prove — a reactive read outside any tracking
// scope (a prop that stops following changes after mount), a signal write from an owned scope,
// a caught not-ready read, a list recreating rows for equal items, a graph that outlives what
// created it — and, with attribution on, the cost checks behind them. Anything it names in
// these scenarios is a finding, not noise. That includes a never-loaded async prop: the prop
// guards read it catch-free (src/core/asyncProps.ts verdict, solidjs/solid#4789). Captured with
// @solidjs/diagnostics in the dev build (browser project).
import type { DiagnosticsArtifact } from "@solidjs/diagnostics";
import { captureArtifact, expectRerunBudget } from "@solidjs/diagnostics";
import { render } from "@solidjs/testing-library";
import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createMemo, createSignal, createStore } from "solid-js";
import { describe, expect, it } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; make: string; price: number; qty: number };

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    make: `m${i % 7}`,
    price: i * 10,
    qty: i % 5,
  }));

const tick = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await tick(10);
  }
};

// a Solid cell renderer and a selection-checkbox column put the framework-renderer branch and
// the cell-wrapper branch (tool widgets) in every scenario
const PriceRenderer = (props: ICellRendererParams<Row>) => <b>{props.value}</b>;
const columns = (): ColDef<Row>[] => [
  { field: "make", checkboxSelection: true },
  { field: "price", cellRenderer: PriceRenderer },
  { field: "qty", editable: true },
  { field: "id" },
];

/** Every diagnostic as `CODE: owner / node`, deduplicated. */
const findings = (artifact: DiagnosticsArtifact): string[] => [
  ...new Set(
    artifact.diagnostics.map((d) => `${d.code}: ${d.ownerName ?? "?"} / ${d.nodeName ?? "?"}`),
  ),
];

const capture = async (scenario: string, run: () => Promise<void>): Promise<string[]> => {
  const { artifact } = await captureArtifact(run, {
    scenario,
    // wall-clock budgets measure the machine, not the graph: off, so CI speed cannot fail this
    attribution: {
      log: false,
      hotTime: { budgetMs: Number.POSITIVE_INFINITY, windowMs: 1000 },
    },
  });
  return findings(artifact);
};

const mountGrid = (extra: Parameters<typeof render>[0]) => {
  const result = render(extra);
  const cellCount = () => result.container.querySelectorAll(".ag-row .ag-cell").length;
  return { ...result, cellCount };
};

describe("runtime diagnostics (dev build)", () => {
  it("mounting, scrolling and streaming transactions emit no diagnostics", async () => {
    const data = makeRows(5000);
    let api: GridApi<Row> | undefined;
    let grid!: ReturnType<typeof mountGrid>;
    expect(
      await capture("mount + scroll + stream", async () => {
        grid = mountGrid(() => (
          <AgGridSolid
            containerStyle={{ height: "300px", width: "700px" }}
            columnDefs={columns()}
            rowData={data}
            getRowId={(p) => p.data.id}
            ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
          />
        ));
        await waitFor(() => api != null && grid.cellCount() > 20);
        // row swaps: rows unmount and mount through the Solid renderer and wrapper branches
        for (const index of [500, 2500, 4900]) {
          api!.ensureIndexVisible(index, "top");
          await tick(50);
        }
        // value ticks reach mounted Solid renderers through pushed params
        const visible = data.slice(4880, 5000);
        for (let t = 1; t <= 4; t++) {
          api!.applyTransaction({ update: visible.map((r) => ({ ...r, price: r.price + t })) });
          await tick(20);
        }
      }),
    ).toEqual([]);
    expect(grid.container.querySelector('.ag-row[row-id="r4900"] b')?.textContent).toBe("49004");
  });

  it("changing rowData and columnDefs props emits no diagnostics", async () => {
    const [rowData, setRowData] = createSignal(makeRows(50));
    const [columnDefs, setColumnDefs] = createSignal(columns());
    let api: GridApi<Row> | undefined;
    const grid = mountGrid(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "700px" }}
        columnDefs={columnDefs()}
        rowData={rowData()}
        getRowId={(p) => p.data.id}
        ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
      />
    ));
    await waitFor(() => api != null && grid.cellCount() > 20);
    expect(
      await capture("prop changes", async () => {
        setRowData(makeRows(60));
        await tick();
        setColumnDefs(columns().slice(1));
        await tick();
        setRowData(makeRows(40));
        await tick();
      }),
    ).toEqual([]);
    expect(grid.container.querySelector('.ag-header-cell[col-id="make"]')).toBeNull();
    expect(api!.getDisplayedRowCount()).toBe(40);
  });

  it("inline editing sessions emit no diagnostics", async () => {
    let api: GridApi<Row> | undefined;
    const grid = mountGrid(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "700px" }}
        columnDefs={columns()}
        rowData={makeRows(20)}
        getRowId={(p) => p.data.id}
        ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
      />
    ));
    await waitFor(() => api != null && grid.cellCount() > 20);
    let editorsSeen = 0;
    expect(
      await capture("inline edit", async () => {
        for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
          api!.startEditingCell({ rowIndex, colKey: "qty" });
          await tick();
          editorsSeen += grid.container.querySelectorAll(".ag-cell-inline-editing").length;
          api!.stopEditing();
          await tick();
        }
      }),
    ).toEqual([]);
    expect(editorsSeen).toBe(3);
  });

  it("rowStore field writes and a push emit no diagnostics", async () => {
    const [store, setStore] = createStore<Row[]>(makeRows(200));
    let api: GridApi<Row> | undefined;
    const grid = mountGrid(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "700px" }}
        columnDefs={columns()}
        rowStore={store}
        getRowId={(p) => p.data.id}
        ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
      />
    ));
    await waitFor(() => api != null && grid.cellCount() > 20);
    expect(
      await capture("rowStore", async () => {
        for (let i = 0; i < 3; i++) {
          setStore((draft) => {
            draft[i]!.price += 1;
          });
          await tick(80);
        }
        setStore((draft) => {
          draft.push({ id: "new", make: "x", price: 1, qty: 1 });
        });
        await tick(80);
      }),
    ).toEqual([]);
    expect(api!.getRowNode("r0")?.data?.price).toBe(1);
    expect(api!.getRowNode("new")).toBeDefined();
  });

  it("a Solid loading overlay shown and hidden through a prop emits no diagnostics", async () => {
    const Overlay = () => <div class="solid-overlay">loading…</div>;
    const [loading, setLoading] = createSignal(false);
    let api: GridApi<Row> | undefined;
    const grid = mountGrid(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "700px" }}
        columnDefs={columns()}
        rowData={makeRows(10)}
        loading={loading()}
        loadingOverlayComponent={Overlay}
        ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
      />
    ));
    await waitFor(() => api != null);
    let overlayShown = false;
    expect(
      await capture("overlay", async () => {
        setLoading(true);
        await waitFor(() => grid.container.querySelector(".solid-overlay") != null);
        overlayShown = true;
        setLoading(false);
        await waitFor(() => grid.container.querySelector(".solid-overlay") == null);
      }),
    ).toEqual([]);
    expect(overlayShown).toBe(true);
  });

  it("a never-loaded async rowData emits no diagnostics, then loads", async () => {
    let resolve!: (rows: Row[]) => void;
    const promise = new Promise<Row[]>((r) => (resolve = r));
    let api: GridApi<Row> | undefined;
    let grid!: ReturnType<typeof mountGrid>;
    const seen = await capture("async rowData", async () => {
      grid = mountGrid(() => {
        const rowData = createMemo(() => promise);
        return (
          <AgGridSolid
            containerStyle={{ height: "300px", width: "700px" }}
            columnDefs={columns()}
            rowData={rowData()}
            ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
          />
        );
      });
      await tick(50);
      resolve(makeRows(30));
      await waitFor(() => api != null && grid.cellCount() > 20);
    });
    expect(seen).toEqual([]);
    expect(api!.getDisplayedRowCount()).toBe(30);
  });
});

// UPDATE GRANULARITY: a value change reaches only the cell it changes. Counted as re-runs of
// existing scopes (attribution), so a fan-out to the row, the column or the viewport — every
// visible cell re-checking its details — fails with the offending scopes as evidence. The
// budgets are the measured counts for one cell on Solid 2.0.0-rc.21: tighten them if a change
// makes the cell cheaper; raise them only with a design note.
describe("re-run budgets (update granularity)", () => {
  const RendererCell = (props: ICellRendererParams<Row>) => <b>{props.value}</b>;
  const granularColumns: ColDef<Row>[] = [
    { field: "price", cellRenderer: RendererCell },
    { field: "qty" },
  ];

  const mountForUpdates = async () => {
    const data = makeRows(50);
    let api: GridApi<Row> | undefined;
    const grid = mountGrid(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={granularColumns}
        rowData={data}
        getRowId={(p) => p.data.id}
        ref={(r: AgGridSolidRef<Row>) => (api = r.api)}
      />
    ));
    await waitFor(() => api != null && grid.cellCount() > 10);
    await tick();
    return { data, api: api!, grid };
  };

  const captureUpdate = async (run: () => void) => {
    const { artifact } = await captureArtifact(
      async () => {
        run();
        await tick(40);
      },
      { scenario: "one-cell update", attribution: { log: false } },
    );
    return artifact;
  };

  it("one Solid-renderer cell's value: only that cell's three scopes re-run", async () => {
    const { data, api, grid } = await mountForUpdates();
    const rendered = grid.container.querySelector('.ag-row[row-id="r3"] b');
    const artifact = await captureUpdate(() =>
      api.applyTransaction({ update: [{ ...data[3]!, price: 999 }] }),
    );
    // renderer props merge, refresh bridge, the renderer's text
    expectRerunBudget(artifact, 3);
    // the wrapper decision and the renderer identity read the renderer slot, which a value
    // refresh never changes (the compDetails object it replaces is not read by either)
    expectRerunBudget(artifact, 0, { scope: "showCellWrapper" });
    expectRerunBudget(artifact, 0, { scope: "frameworkRendererInfo" });
    // the value reached the mounted renderer: same element, not a remount (a remount trades
    // re-runs for creations, so the budget above cannot see it)
    const after = grid.container.querySelector('.ag-row[row-id="r3"] b');
    expect(after?.textContent).toBe("999");
    expect(after).toBe(rendered);
  });

  it("one plain cell's value: only its value memo and text re-run", async () => {
    const { data, api, grid } = await mountForUpdates();
    const artifact = await captureUpdate(() =>
      api.applyTransaction({ update: [{ ...data[4]!, qty: 999 }] }),
    );
    expectRerunBudget(artifact, 2);
    expect(
      grid.container.querySelector('.ag-row[row-id="r4"] .ag-cell[col-id="qty"]')?.textContent,
    ).toBe("999");
  });
});
