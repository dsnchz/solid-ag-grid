// T6 acceptance bar (design doc: .agent/planning/tasks/T6-row-store-adapter.md):
// 1. PARITY — store mutations produce grid state identical to hand-written transactions
//    (vanilla createGrid oracle) for adds, removes, field updates and mixed bursts.
// 2. THE OPTIMISTIC SCENARIO end-to-end — createOptimisticStore + action + flaky server:
//    row visible pre-settle, persists on success, auto-removed on failure via overlay
//    revert; zero user grid-API calls, zero console errors/warnings.
// 3. Rapid-mutation stress — 100+ mutations in one tick converge to the store's state.
import { render } from "@solidjs/testing-library";
import type { GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
// eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
import { action, createOptimisticStore, createStore, snapshot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly id: string; name: string; qty: number };

const initialRows = (): Row[] => [
  { id: "a", name: "alpha", qty: 1 },
  { id: "b", name: "beta", qty: 2 },
  { id: "c", name: "gamma", qty: 3 },
];

const columnDefs = [{ field: "name" as const }, { field: "qty" as const }];
const getRowId = (params: { data: Row }) => params.data.id;

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

/** Mounts a vanilla (createGrid) oracle grid; returns its container + api + destroy. */
const mountVanilla = (options: GridOptions<Row>) => {
  const container = document.createElement("div");
  container.style.height = "300px";
  container.style.width = "600px";
  document.body.appendChild(container);
  const api = createGrid<Row>(container, options);
  return {
    container,
    api,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
};

/** row-id → { rowIndex, colId → cell text } for every rendered row. */
const collectRows = (root: Element) => {
  const rows = new Map<string, { rowIndex: string | null; cells: Map<string, string> }>();
  for (const row of root.querySelectorAll<HTMLElement>(".ag-row")) {
    const rowId = row.getAttribute("row-id");
    if (rowId == null) {
      continue;
    }
    const cells = new Map<string, string>();
    for (const cell of row.querySelectorAll<HTMLElement>(".ag-cell")) {
      cells.set(cell.getAttribute("col-id")!, cell.textContent ?? "");
    }
    rows.set(rowId, { rowIndex: row.getAttribute("row-index"), cells });
  }
  return rows;
};

const expectRowParity = (solidRoot: Element, vanillaRoot: Element) => {
  const sRows = collectRows(solidRoot);
  const vRows = collectRows(vanillaRoot);
  expect([...sRows.keys()].sort()).toEqual([...vRows.keys()].sort());
  for (const [rowId, vRow] of vRows) {
    const sRow = sRows.get(rowId)!;
    expect(sRow.rowIndex, `row-index differs for row ${rowId}`).toBe(vRow.rowIndex);
    expect(Object.fromEntries(sRow.cells), `cells differ for row ${rowId}`).toEqual(
      Object.fromEntries(vRow.cells),
    );
  }
};

describe("rowStore adapter (browser)", () => {
  it("parity: adds, removes, field updates and a mixed burst match hand-written transactions", async () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const vanilla = mountVanilla({ columnDefs, rowData: initialRows(), getRowId });
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowStore={store}
        getRowId={getRowId}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-row").length >= 3);
    await waitFor(() => vanilla.container.querySelectorAll(".ag-row").length >= 3);
    expectRowParity(container, vanilla.container);

    // ---- adds: append, prepend, middle insert (one tick) ----
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
      draft.unshift({ id: "z", name: "zeta", qty: 0 });
      draft.splice(2, 0, { id: "m", name: "mu", qty: 9 });
    });
    // hand-written mirror of the net diff ([z,a,m,b,c,d]): z@0, m@2, d@5
    vanilla.api.applyTransaction({ add: [{ id: "z", name: "zeta", qty: 0 }], addIndex: 0 });
    vanilla.api.applyTransaction({ add: [{ id: "m", name: "mu", qty: 9 }], addIndex: 2 });
    vanilla.api.applyTransaction({ add: [{ id: "d", name: "delta", qty: 4 }], addIndex: 5 });
    await waitFor(() => container.querySelectorAll(".ag-row").length >= 6);
    expectRowParity(container, vanilla.container);

    // ---- removes: filter form ----
    setStore((draft) => draft.filter((row) => row.id !== "z" && row.id !== "b"));
    vanilla.api.applyTransaction({
      remove: [
        { id: "z", name: "zeta", qty: 0 },
        { id: "b", name: "beta", qty: 2 },
      ],
    });
    await waitFor(() => container.querySelectorAll(".ag-row").length === 4);
    expectRowParity(container, vanilla.container);

    // ---- field updates (async latency lane) ----
    setStore((draft) => {
      draft[0]!.qty = 111;
      draft[2]!.name = "GAMMA";
    });
    vanilla.api.applyTransactionAsync({
      update: [
        { id: "a", name: "alpha", qty: 111 },
        { id: "c", name: "GAMMA", qty: 3 },
      ],
    });
    vanilla.api.flushAsyncTransactions();
    await waitFor(() => {
      const cells = collectRows(container).get("c")?.cells;
      return (
        cells?.get("name") === "GAMMA" &&
        collectRows(container).get("a")?.cells.get("qty") === "111"
      );
    });
    expectRowParity(container, vanilla.container);

    // ---- mixed burst in one tick: remove + insert + append + update ----
    // store before: [a, m, c, d]
    setStore((draft) => {
      draft.splice(1, 1); // remove m -> [a, c, d]
      draft.splice(1, 0, { id: "x", name: "xi", qty: 7 }); // -> [a, x, c, d]
      draft.push({ id: "e", name: "epsilon", qty: 5 }); // -> [a, x, c, d, e]
      draft[0]!.qty = 222;
    });
    vanilla.api.applyTransaction({ remove: [{ id: "m", name: "mu", qty: 9 }] });
    vanilla.api.applyTransaction({ add: [{ id: "x", name: "xi", qty: 7 }], addIndex: 1 });
    vanilla.api.applyTransaction({ add: [{ id: "e", name: "epsilon", qty: 5 }], addIndex: 4 });
    vanilla.api.applyTransactionAsync({ update: [{ id: "a", name: "alpha", qty: 222 }] });
    vanilla.api.flushAsyncTransactions();
    await waitFor(() => collectRows(container).get("a")?.cells.get("qty") === "222");
    await waitFor(() => container.querySelectorAll(".ag-row").length === 5);
    expectRowParity(container, vanilla.container);

    vanilla.destroy();
    unmount();
  });

  it("queues store mutations issued before the grid is ready (no lost writes, no seed clobber)", async () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowStore={store}
        getRowId={getRowId}
      />
    ));
    // synchronously after render — long before boot (onSettled + microtask) and readiness
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
      draft[0]!.qty = 11;
    });
    await waitFor(() => container.querySelectorAll(".ag-row").length === 4);
    await waitFor(() => collectRows(container).get("a")?.cells.get("qty") === "11");
    const rows = collectRows(container);
    expect([...rows.keys()].sort()).toEqual(["a", "b", "c", "d"]);
    unmount();
  });

  it("stress: 100+ mutations in one tick converge to the store's exact rows and order", async () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    let gridRef!: AgGridSolidRef<Row>;
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowStore={store}
        getRowId={getRowId}
        ref={(r) => {
          gridRef = r;
        }}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-row").length >= 3);

    // 130 mutations in one synchronous burst: interleaved appends, prepends, middle inserts,
    // removes and field churn — one reactive flush, one net diff
    setStore((draft) => {
      for (let i = 0; i < 40; i++) {
        draft.push({ id: `p${i}`, name: `push-${i}`, qty: i });
      }
      for (let i = 0; i < 20; i++) {
        draft.splice(i * 2, 0, { id: `s${i}`, name: `splice-${i}`, qty: 100 + i });
      }
      for (let i = 0; i < 30; i++) {
        draft[(i * 7) % draft.length]!.qty = 1000 + i;
      }
      for (let i = 0; i < 15; i++) {
        draft.splice((i * 3) % draft.length, 1);
      }
      for (let i = 0; i < 25; i++) {
        draft[(i * 5) % draft.length]!.name = `churn-${i}`;
      }
    });
    const expected = snapshot(store) as Row[];

    await waitFor(() => {
      const api = gridRef.api;
      return api.getDisplayedRowCount() === expected.length;
    });
    // async update lane: wait until every node's data matches the store snapshot
    await waitFor(() => {
      const nodeData: Row[] = [];
      gridRef.api.forEachNode((node) => nodeData.push(node.data as Row));
      return (
        nodeData.length === expected.length &&
        nodeData.every(
          (row, i) =>
            row.id === expected[i]!.id &&
            row.name === expected[i]!.name &&
            row.qty === expected[i]!.qty,
        )
      );
    });
    unmount();
  });

  it("THE OPTIMISTIC SCENARIO: pre-settle paint, persist on success, auto-remove on failure — zero grid-API calls, zero console noise", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");

    const [rows, setRows] = createStore<Row[]>(initialRows());
    const [optimisticRows, setOptimisticRows] = createOptimisticStore<Row[]>(rows);

    // deterministic flaky server: each call hands control to the test
    let settleServer!: { resolve: (saved: Row) => void; reject: (reason: Error) => void };
    const serverPost = (row: Row): Promise<Row> =>
      new Promise<Row>((resolve, reject) => {
        settleServer = {
          resolve: () => resolve(row),
          reject,
        };
      });

    // the spec-by-example action (generator form — beta.21's action() takes generators; a
    // plain async fn's post-await writes would escape the transaction)
    const addRow = action(function* (row: Row) {
      setOptimisticRows((draft) => {
        draft.push(row); // shows in grid INSTANTLY
      });
      const saved = (yield serverPost(row)) as Row; // background write
      setRows((draft) => {
        draft.push(saved); // confirm into base store
      });
    });

    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={columnDefs}
        rowStore={optimisticRows}
        getRowId={getRowId}
      />
    ));
    await waitFor(() => container.querySelectorAll(".ag-row").length === 3);

    // ---- phase 1: optimistic insert is visible while the server call is still pending ----
    const successRow: Row = { id: "n1", name: "new-row", qty: 42 };
    const successPending = addRow(successRow);
    await waitFor(() => container.querySelector('.ag-row[row-id="n1"]') !== null);
    const optimisticEl = container.querySelector('.ag-row[row-id="n1"]');
    expect(collectRows(container).get("n1")!.cells.get("name")).toBe("new-row");

    // ---- phase 2: success — the row persists across settle (same DOM element: the confirm
    // diffs as a no-op, not remove+add) ----
    settleServer.resolve(successRow);
    await successPending;
    await settle();
    await waitFor(() => container.querySelectorAll(".ag-row").length === 4);
    expect(container.querySelector('.ag-row[row-id="n1"]')).toBe(optimisticEl);
    expect(rows).toHaveLength(4);

    // ---- phase 3: failure — the overlay revert auto-removes the row, zero user code ----
    const failureRow: Row = { id: "n2", name: "doomed", qty: 7 };
    const failurePending = addRow(failureRow).catch(() => "failed");
    await waitFor(() => container.querySelector('.ag-row[row-id="n2"]') !== null);
    settleServer.reject(new Error("server exploded"));
    expect(await failurePending).toBe("failed");
    await waitFor(() => container.querySelector('.ag-row[row-id="n2"]') === null);
    expect(container.querySelectorAll(".ag-row")).toHaveLength(4);
    expect(rows).toHaveLength(4);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    unmount();
  });
});
