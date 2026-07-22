// T6 adapter bookkeeping: add/remove/update detection against the prev-keys map, snapshot
// (never-proxy) emission, ready-queue gating, disposal, and the dev-mode validation messages
// in the agGridSolid wiring. Browser parity/optimistic coverage lives in
// test/browser/rowStore.browser.test.tsx.
import { render } from "@solidjs/testing-library";
import type { ColDef, GridApi, RowDataTransaction } from "ag-grid-community";
import { AllCommunityModule, getGridApi, ModuleRegistry } from "ag-grid-community";
import {
  $PROXY,
  $TRACK,
  action,
  createEffect,
  createOptimisticStore,
  createRoot,
  // eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
  createStore,
  flush,
} from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRowStoreAdapter } from "../../src/core/rowStoreAdapter";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly id: string; name: string; qty: number };

const initialRows = (): Row[] => [
  { id: "a", name: "alpha", qty: 1 },
  { id: "b", name: "beta", qty: 2 },
  { id: "c", name: "gamma", qty: 3 },
];

/** applyTransactionAsync buffers for one microtask; let the queue drain fully. */
const microtasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Call = { readonly kind: "sync" | "async"; readonly txn: RowDataTransaction<Row> };

/** Adapter under a disposable root with a recording fake GridApi and an immediate ready gate. */
const mountAdapter = (rows: Row[] = initialRows()) => {
  const [store, setStore] = createStore<Row[]>(rows);
  const calls: Call[] = [];
  const fakeApi = {
    applyTransaction: (txn: RowDataTransaction<Row>) => {
      calls.push({ kind: "sync", txn });
      return null;
    },
    applyTransactionAsync: (txn: RowDataTransaction<Row>) => {
      calls.push({ kind: "async", txn });
    },
  } as unknown as GridApi<Row>;

  let seedRows: readonly Row[] = [];
  const dispose = createRoot((d) => {
    const adapter = createRowStoreAdapter<Row>({
      store,
      getRowKey: (data) => data.id,
      getApi: () => fakeApi,
      processWhenReady: (fn) => fn(),
    });
    seedRows = adapter.seedRows;
    return d;
  });
  flush();
  return { store, setStore, calls, dispose, seedRows };
};

describe("createRowStoreAdapter bookkeeping", () => {
  it("seeds a plain snapshot and emits nothing for an unchanged store", () => {
    const { calls, seedRows, store } = mountAdapter();
    expect(seedRows).toEqual(initialRows());
    // never-proxy across the grid boundary: the seed rows are not the store proxies
    expect(seedRows[0]).not.toBe(store[0]);
    expect(calls).toEqual([]);
  });

  it("detects a push as a sync appended add carrying a plain snapshot", () => {
    const { setStore, calls, store } = mountAdapter();
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("sync");
    expect(calls[0]!.txn).toEqual({ add: [{ id: "d", name: "delta", qty: 4 }], addIndex: 3 });
    expect(calls[0]!.txn.add![0]).not.toBe(store[3]);
  });

  it("detects positional inserts: unshift and middle-splice carry their store index", () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => {
      draft.unshift({ id: "z", name: "zeta", qty: 0 });
    });
    flush();
    setStore((draft) => {
      draft.splice(2, 0, { id: "m", name: "mu", qty: 9 });
    });
    flush();
    expect(calls.map((c) => c.txn.addIndex)).toEqual([0, 2]);
  });

  it("groups a multi-insert burst into contiguous runs, ascending", () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => {
      draft.splice(1, 0, { id: "x", name: "xi", qty: 7 }, { id: "y", name: "psi", qty: 8 });
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.txn).toEqual({
      add: [
        { id: "x", name: "xi", qty: 7 },
        { id: "y", name: "psi", qty: 8 },
      ],
      addIndex: 1,
    });
    expect(calls[1]!.txn).toEqual({ add: [{ id: "d", name: "delta", qty: 4 }], addIndex: 5 });
  });

  it("detects removal (filter form) and emits the stored snapshot as the remove payload", () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => draft.filter((row) => row.id !== "b"));
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("sync");
    expect(calls[0]!.txn.remove).toEqual([{ id: "b", name: "beta", qty: 2 }]);
  });

  it("batches same-tick field updates into one async update transaction of plain copies", async () => {
    const { setStore, calls, store } = mountAdapter();
    setStore((draft) => {
      draft[0]!.qty = 100;
    });
    setStore((draft) => {
      draft[0]!.name = "ALPHA";
      draft[2]!.qty = 300;
    });
    flush();
    await microtasks();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("async");
    // one entry per row regardless of how many writes it took, latest values win
    expect(calls[0]!.txn.update).toEqual([
      { id: "a", name: "ALPHA", qty: 100 },
      { id: "c", name: "gamma", qty: 300 },
    ]);
    expect(calls[0]!.txn.update![0]).not.toBe(store[0]);
  });

  it("field updates on SEEDED rows project too (pre-mount entries get projections attached)", async () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => {
      draft[1]!.qty = 22;
    });
    flush();
    await microtasks();
    expect(calls).toEqual([
      { kind: "async", txn: { update: [{ id: "b", name: "beta", qty: 22 }] } },
    ]);
  });

  it("drops a same-tick field update for a row that was also removed", async () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => {
      draft[1]!.qty = 999;
      draft.splice(1, 1);
    });
    flush();
    await microtasks();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.txn.remove?.map((r) => (r as Row).id)).toEqual(["b"]);
  });

  it("an added row does not double-emit: the add carries the data, the projection only seeds", async () => {
    const { setStore, calls } = mountAdapter();
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    await microtasks();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe("sync");
    // ...and a LATER field write on that row projects as a normal update
    setStore((draft) => {
      draft[3]!.qty = 44;
    });
    flush();
    await microtasks();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.txn.update).toEqual([{ id: "d", name: "delta", qty: 44 }]);
  });

  it("diffs mutations that land before the first flush against the seed baseline (no double-apply)", () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const calls: Call[] = [];
    const fakeApi = {
      applyTransaction: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "sync", txn });
        return null;
      },
      applyTransactionAsync: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "async", txn });
      },
    } as unknown as GridApi<Row>;
    const dispose = createRoot((d) => {
      createRowStoreAdapter<Row>({
        store,
        getRowKey: (data) => data.id,
        getApi: () => fakeApi,
        processWhenReady: (fn) => fn(),
      });
      return d;
    });
    // mutate BEFORE the adapter's effects ever ran
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.txn.add).toEqual([{ id: "d", name: "delta", qty: 4 }]);
    dispose();
  });

  it("queues emissions through the ready gate and replays them in arrival order", async () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const calls: Call[] = [];
    const fakeApi = {
      applyTransaction: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "sync", txn });
        return null;
      },
      applyTransactionAsync: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "async", txn });
      },
    } as unknown as GridApi<Row>;
    const queued: (() => void)[] = [];
    const dispose = createRoot((d) => {
      createRowStoreAdapter<Row>({
        store,
        getRowKey: (data) => data.id,
        getApi: () => fakeApi,
        processWhenReady: (fn) => queued.push(fn),
      });
      return d;
    });
    flush();
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    flush();
    setStore((draft) => {
      draft[0]!.qty = 11;
    });
    flush();
    await microtasks();
    expect(calls).toEqual([]);
    for (const fn of queued) {
      fn();
    }
    expect(calls.map((c) => c.kind)).toEqual(["sync", "async"]);
    expect(calls[0]!.txn.add).toEqual([{ id: "d", name: "delta", qty: 4 }]);
    expect(calls[1]!.txn.update).toEqual([{ id: "a", name: "alpha", qty: 11 }]);
    dispose();
  });

  it("disposal silences every projection (structural and per-row)", async () => {
    const { setStore, calls, dispose } = mountAdapter();
    dispose();
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
      draft[0]!.qty = 999;
    });
    flush();
    await microtasks();
    expect(calls).toEqual([]);
  });

  it("optimistic view over a base store: seed and payloads are PLAIN (the beta.21 snapshot() proxy-leak guard)", () => {
    const [rows] = createStore<Row[]>(initialRows());
    const [optimistic] = createOptimisticStore<Row[]>(rows);
    const isProxy = (value: object) =>
      (value as { readonly [key: symbol]: unknown })[$PROXY] !== undefined;

    let seedRows: readonly Row[] = [];
    const dispose = createRoot((d) => {
      const adapter = createRowStoreAdapter<Row>({
        store: optimistic,
        getRowKey: (data) => data.id,
        getApi: () => undefined,
        processWhenReady: (fn) => fn(),
      });
      seedRows = adapter.seedRows;
      return d;
    });
    flush();
    // without the plainSnapshot guard, snapshot(optimistic) returns the BASE STORE'S PROXY
    // for unmodified values (see the verdict in src/core/rowStoreAdapter.ts)
    expect(isProxy(seedRows as unknown as object)).toBe(false);
    for (const row of seedRows) {
      expect(isProxy(row)).toBe(false);
    }
    expect(seedRows).toEqual(initialRows());
    dispose();
  });

  it("optimistic revert projects as a plain remove (no optimistic-specific code path)", async () => {
    const [rows] = createStore<Row[]>(initialRows());
    const [optimistic, setOptimistic] = createOptimisticStore<Row[]>(rows);
    const calls: Call[] = [];
    const fakeApi = {
      applyTransaction: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "sync", txn });
        return null;
      },
      applyTransactionAsync: (txn: RowDataTransaction<Row>) => {
        calls.push({ kind: "async", txn });
      },
    } as unknown as GridApi<Row>;
    const dispose = createRoot((d) => {
      createRowStoreAdapter<Row>({
        store: optimistic,
        getRowKey: (data) => data.id,
        getApi: () => fakeApi,
        processWhenReady: (fn) => fn(),
      });
      return d;
    });
    flush();

    let rejectServer!: (reason: Error) => void;
    const serverCall = new Promise<never>((_, reject) => {
      rejectServer = reject;
    });
    const addRow = action(function* (row: Row) {
      setOptimistic((draft) => {
        draft.push(row);
      });
      yield serverCall;
    });
    const pending = addRow({ id: "temp-1", name: "tentative", qty: 9 }).catch(() => "failed");
    flush();
    await microtasks();
    // optimistic write projected instantly as a sync add — and the payload is plain
    expect(calls.map((c) => c.kind)).toEqual(["sync"]);
    expect(calls[0]!.txn.add).toEqual([{ id: "temp-1", name: "tentative", qty: 9 }]);
    expect((calls[0]!.txn.add![0] as { readonly [key: symbol]: unknown })[$PROXY]).toBeUndefined();

    rejectServer(new Error("boom"));
    expect(await pending).toBe("failed");
    flush();
    await microtasks();
    // overlay revert is just another structural change: exactly one remove, no updates
    expect(calls).toHaveLength(2);
    expect(calls[1]!.kind).toBe("sync");
    expect(calls[1]!.txn.remove?.map((r) => (r as Row).id)).toEqual(["temp-1"]);
    dispose();
  });

  it("EMPIRICAL: optimistic revert invalidates per-row (path granularity), not whole-array", async () => {
    const [rows] = createStore<Row[]>(initialRows());
    const [optimistic, setOptimistic] = createOptimisticStore<Row[]>(rows);
    const fieldRuns = [0, 0, 0];
    let structuralRuns = 0;
    const dispose = createRoot((d) => {
      for (let i = 0; i < 3; i++) {
        createEffect(
          () => optimistic[i]!.qty,
          () => {
            fieldRuns[i]! += 1;
          },
        );
      }
      createEffect(
        () => {
          void (optimistic as unknown as { [key: symbol]: unknown })[$TRACK];
          return optimistic.map((row) => row);
        },
        () => {
          structuralRuns += 1;
        },
      );
      return d;
    });
    flush();
    expect(fieldRuns).toEqual([1, 1, 1]);
    const baselineStructural = structuralRuns;

    let rejectServer!: (reason: Error) => void;
    const serverCall = new Promise<never>((_, reject) => {
      rejectServer = reject;
    });
    const bumpQty = action(function* () {
      setOptimistic((draft) => {
        draft[1]!.qty = 999;
      });
      yield serverCall;
    });
    const pending = bumpQty().catch(() => undefined);
    flush();
    expect(fieldRuns).toEqual([1, 2, 1]);
    rejectServer(new Error("boom"));
    await pending;
    flush();
    await microtasks();
    // revert re-ran ONLY the touched row's projection; a field-only optimistic write never
    // re-ran the structural compute in either direction
    expect(fieldRuns).toEqual([1, 3, 1]);
    expect(structuralRuns).toBe(baselineStructural);
    dispose();
  });
});

describe("rowStore dev validation (agGridSolid wiring)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const columnDefs: ColDef<Row>[] = [{ field: "name" }, { field: "qty" }];
  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  it("warns when rowData and rowStore are both provided (rowData is ignored)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [store] = createStore<Row[]>(initialRows());
    const { unmount } = render(() => (
      <AgGridSolid
        columnDefs={columnDefs}
        rowData={[{ id: "x", name: "shadowed", qty: 0 }]}
        rowStore={store}
        getRowId={(params) => params.data.id}
      />
    ));
    await settle();
    expect(warnSpy).toHaveBeenCalledWith(
      "AG Grid: both `rowData` and `rowStore` are provided — `rowData` is ignored; the row store drives row data.",
    );
    unmount();
  });

  it("errors when rowStore is provided without getRowId and disables the projection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store] = createStore<Row[]>(initialRows());
    const { unmount } = render(() => <AgGridSolid columnDefs={columnDefs} rowStore={store} />);
    await settle();
    expect(errorSpy).toHaveBeenCalledWith(
      "AG Grid: `rowStore` requires a `getRowId` callback (stable, data-derived row ids) — live row-store projection is disabled.",
    );
    unmount();
  });

  it("pre-ready store mutations land after the boot seed (ready-gate law: a raw pre-ready applyTransaction clobbers the seed — see the verdict in src/core/rowStoreAdapter.ts)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store, setStore] = createStore<Row[]>(initialRows());
    const { container, unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowStore={store} getRowId={(params) => params.data.id} />
    ));
    // mutate synchronously after render — long before boot (onSettled + microtask), so this
    // structural add MUST queue behind the ready gate rather than race the seed
    setStore((draft) => {
      draft.push({ id: "d", name: "delta", qty: 4 });
    });
    await settle();
    const api = getGridApi(container.firstElementChild as HTMLElement);
    const ids: string[] = [];
    api?.forEachNode((node) => ids.push((node.data as Row).id));
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    unmount();
  });

  it("stays silent when rowStore is configured correctly", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store] = createStore<Row[]>(initialRows());
    const { unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowStore={store} getRowId={(params) => params.data.id} />
    ));
    await settle();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    unmount();
  });
});
