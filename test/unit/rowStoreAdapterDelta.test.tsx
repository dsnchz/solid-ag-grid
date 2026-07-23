// Delta-capture coverage for the rowStore adapter (solid-js >= 2.0.0-beta.24 — the
// snapshot()/deep() per-item forms are plain even on optimistic views since
// solidjs/solid@a5fe9fb). Pins, in order:
// 1. THE IDENTITY PROBE — row handles are identity-stable across moves/splices and
//    optimistic overlay/revert; the ONE break is the settle-confirm handle swap. The
//    structural pointer-diff design rests on this.
// 2. Never-proxy on per-item payloads: the async update payload is deep(row)'s return,
//    captured at invalidation time on an optimistic view — must be plain.
// 3. Structural delta: unchanged rows are NOT re-keyed/re-snapshotted (getRowKey spy).
// 4. The rebind law: after an optimistic settle-confirm swaps the row handle, field writes
//    on the confirmed row still project (the projection rebinds to the new handle), and the
//    settle itself stays emission-free.
import type { GridApi, RowDataTransaction } from "ag-grid-community";
import {
  $PROXY,
  action,
  createOptimisticStore,
  createRoot,
  // eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
  createStore,
  flush,
  untrack,
} from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { createRowStoreAdapter } from "../../src/core/rowStoreAdapter";

type Row = { readonly id: string; name: string; qty: number };

const initialRows = (): Row[] => [
  { id: "a", name: "alpha", qty: 1 },
  { id: "b", name: "beta", qty: 2 },
  { id: "c", name: "gamma", qty: 3 },
];

/** applyTransactionAsync buffers for one microtask; let the queue drain fully. */
const microtasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const isProxy = (value: object) =>
  (value as { readonly [key: symbol]: unknown })[$PROXY] !== undefined;

type Call = { readonly kind: "sync" | "async"; readonly txn: RowDataTransaction<Row> };

const recordingApi = (calls: Call[]): GridApi<Row> =>
  ({
    applyTransaction: (txn: RowDataTransaction<Row>) => {
      calls.push({ kind: "sync", txn });
      return null;
    },
    applyTransactionAsync: (txn: RowDataTransaction<Row>) => {
      calls.push({ kind: "async", txn });
    },
  }) as unknown as GridApi<Row>;

const mountAdapter = <TStore extends readonly Row[]>(
  store: TStore,
  getRowKey: (data: Row) => string = (data) => data.id,
) => {
  const calls: Call[] = [];
  const fakeApi = recordingApi(calls);
  const dispose = createRoot((d) => {
    createRowStoreAdapter<Row>({
      store,
      getRowKey,
      getApi: () => fakeApi,
      processWhenReady: (fn) => fn(),
    });
    return d;
  });
  flush();
  return { calls, dispose };
};

describe("row-handle identity (the probe the structural pointer-diff rests on)", () => {
  it("plain store: handles are identity-stable across move, middle insert, and field write", () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const before = untrack(() => store.map((row) => row));

    // move: remove head, re-append
    setStore((draft) => {
      const [moved] = draft.splice(0, 1);
      draft.push(moved!);
    });
    flush();
    const afterMove = untrack(() => store.map((row) => row));
    expect(afterMove[2]).toBe(before[0]);
    expect(afterMove[0]).toBe(before[1]);
    expect(afterMove[1]).toBe(before[2]);

    // middle insert shifts positions — shifted rows keep their handles
    setStore((draft) => {
      draft.splice(1, 0, { id: "x", name: "xi", qty: 7 });
    });
    flush();
    const afterInsert = untrack(() => store.map((row) => row));
    expect(afterInsert[0]).toBe(afterMove[0]);
    expect(afterInsert[2]).toBe(afterMove[1]);
    expect(afterInsert[3]).toBe(afterMove[2]);

    // a field write does not change the handle
    setStore((draft) => {
      draft[0]!.qty = 999;
    });
    flush();
    expect(untrack(() => store[0])).toBe(afterInsert[0]);
  });

  it("optimistic view: handles are stable across overlay move and revert; settle-confirm SWAPS the handle", async () => {
    const [base, setBase] = createStore<Row[]>(initialRows());
    let view!: readonly Row[];
    let setView!: ReturnType<typeof createOptimisticStore<Row[]>>[1];
    const dispose = createRoot((d) => {
      [view, setView] = createOptimisticStore<Row[]>(base);
      return d;
    });
    flush();
    const before = untrack(() => view.map((row) => row));

    // overlay move: untouched rows and the moved row all keep identity
    let rejectServer!: (reason: Error) => void;
    const serverCall = new Promise<never>((_, reject) => {
      rejectServer = reject;
    });
    const move = action(function* () {
      setView((draft) => {
        const [moved] = draft.splice(0, 1);
        draft.push(moved!);
      });
      yield serverCall;
    });
    const pending = move().catch(() => "failed");
    flush();
    const during = untrack(() => view.map((row) => row));
    expect(during[2]).toBe(before[0]);
    expect(during[0]).toBe(before[1]);
    expect(during[1]).toBe(before[2]);

    // revert restores the original handles exactly
    rejectServer(new Error("boom"));
    expect(await pending).toBe("failed");
    flush();
    const reverted = untrack(() => view.map((row) => row));
    expect(reverted[0]).toBe(before[0]);
    expect(reverted[1]).toBe(before[1]);
    expect(reverted[2]).toBe(before[2]);

    // settle-confirm: the overlay handle is REPLACED by the base-backed one — the one
    // identity instability; the adapter handles it by rebinding the row's projection
    let resolveServer!: () => void;
    const serverOk = new Promise<void>((resolve) => {
      resolveServer = () => resolve();
    });
    const addRow = action(function* (row: Row) {
      setView((draft) => {
        draft.push({ ...row });
      });
      yield serverOk;
      setBase((draft) => {
        draft.push({ ...row });
      });
    });
    const confirming = addRow({ id: "n1", name: "new", qty: 9 });
    flush();
    const overlayHandle = untrack(() => view[3]);
    resolveServer();
    await confirming;
    flush();
    const settledHandle = untrack(() => view[3]);
    expect(settledHandle).not.toBe(overlayHandle);
    // ...while the untouched rows keep identity across the settle
    expect(untrack(() => view[0])).toBe(before[0]);
    dispose();
  });
});

describe("delta field capture (invalidation-time payloads)", () => {
  it("never-proxy: the async update payload on an OPTIMISTIC VIEW is plain (deep(row)'s return)", async () => {
    const [base] = createStore<Row[]>(initialRows());
    const calls: Call[] = [];
    const fakeApi = recordingApi(calls);
    let view!: readonly Row[];
    let setView!: ReturnType<typeof createOptimisticStore<Row[]>>[1];
    const dispose = createRoot((d) => {
      [view, setView] = createOptimisticStore<Row[]>(base);
      createRowStoreAdapter<Row>({
        store: view,
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
    const bumpQty = action(function* () {
      setView((draft) => {
        draft[1]!.qty = 999;
      });
      yield serverCall;
    });
    const pending = bumpQty().catch(() => "failed");
    flush();
    await microtasks();

    // the optimistic field write projected as ONE async update whose payload is plain —
    // not the view's row proxy, and not any proxy at all
    expect(calls.map((c) => c.kind)).toEqual(["async"]);
    const payload = calls[0]!.txn.update![0] as Row;
    expect(payload).toEqual({ id: "b", name: "beta", qty: 999 });
    expect(isProxy(payload)).toBe(false);
    expect(payload).not.toBe(untrack(() => view[1]));

    rejectServer(new Error("boom"));
    expect(await pending).toBe("failed");
    flush();
    await microtasks();
    // the revert projects as another async update (per-row granularity), also plain
    expect(calls).toHaveLength(2);
    const revertPayload = calls[1]!.txn.update![0] as Row;
    expect(revertPayload).toEqual({ id: "b", name: "beta", qty: 2 });
    expect(isProxy(revertPayload)).toBe(false);
    dispose();
  });
});

describe("structural delta (unchanged rows do no heavy work)", () => {
  it("re-keys ONLY new/changed handles: push=1, field write=0, remove=0, middle insert=1", async () => {
    const manyRows = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      name: `row-${i}`,
      qty: i,
    }));
    const [store, setStore] = createStore<Row[]>(manyRows);
    const getRowKey = vi.fn((data: Row) => data.id);
    const { calls, dispose } = mountAdapter(store, getRowKey);
    // boot cost is O(n) once: seed pass + first structural pass key every row
    expect(getRowKey.mock.calls.length).toBe(200);

    // push: exactly ONE key derivation (the new row) — the other 100 are pointer-diff hits
    getRowKey.mockClear();
    setStore((draft) => {
      draft.push({ id: "new", name: "pushed", qty: -1 });
    });
    flush();
    expect(getRowKey.mock.calls.length).toBe(1);
    expect(calls.at(-1)!.txn.add![0]).toEqual({ id: "new", name: "pushed", qty: -1 });

    // field write: zero key derivations (field lane never touches the structural pass)
    getRowKey.mockClear();
    setStore((draft) => {
      draft[3]!.qty = 12345;
    });
    flush();
    await microtasks();
    expect(getRowKey.mock.calls.length).toBe(0);
    expect(calls.at(-1)!.txn.update).toEqual([{ id: "r3", name: "row-3", qty: 12345 }]);

    // remove: zero key derivations (survivors shift positions but keep their handles)
    getRowKey.mockClear();
    setStore((draft) => {
      draft.splice(50, 1);
    });
    flush();
    expect(getRowKey.mock.calls.length).toBe(0);
    expect(calls.at(-1)!.txn.remove?.map((r) => (r as Row).id)).toEqual(["r50"]);

    // middle insert: exactly ONE key derivation despite 50 rows shifting position
    getRowKey.mockClear();
    setStore((draft) => {
      draft.splice(25, 0, { id: "mid", name: "inserted", qty: -2 });
    });
    flush();
    expect(getRowKey.mock.calls.length).toBe(1);
    expect(calls.at(-1)!.txn).toEqual({
      add: [{ id: "mid", name: "inserted", qty: -2 }],
      addIndex: 25,
    });
    dispose();
  });

  it("remove then re-add of the SAME row object emits a fresh add (WeakMap key survives, entry does not)", () => {
    const [store, setStore] = createStore<Row[]>(initialRows());
    const { calls, dispose } = mountAdapter(store);
    const rawB: Row = { id: "b", name: "beta", qty: 2 };

    setStore((draft) => draft.filter((row) => row.id !== "b"));
    flush();
    expect(calls.at(-1)!.txn.remove?.map((r) => (r as Row).id)).toEqual(["b"]);

    setStore((draft) => {
      draft.push(rawB);
    });
    flush();
    expect(calls.at(-1)!.txn.add?.map((r) => (r as Row).id)).toEqual(["b"]);
    dispose();
  });
});

describe("the rebind law (optimistic settle-confirm handle swap)", () => {
  it("post-settle field writes on a confirmed row still project; the settle itself is emission-free", async () => {
    const [base, setBase] = createStore<Row[]>(initialRows());
    const calls: Call[] = [];
    const fakeApi = recordingApi(calls);
    let setView!: ReturnType<typeof createOptimisticStore<Row[]>>[1];
    const dispose = createRoot((d) => {
      const [view, sv] = createOptimisticStore<Row[]>(base);
      setView = sv;
      createRowStoreAdapter<Row>({
        store: view,
        getRowKey: (data) => data.id,
        getApi: () => fakeApi,
        processWhenReady: (fn) => fn(),
      });
      return d;
    });
    flush();

    // optimistic add confirmed by a base push of a DIFFERENT object (the typical
    // server-confirm shape) — guarantees the handle swap
    let resolveServer!: () => void;
    const serverOk = new Promise<void>((resolve) => {
      resolveServer = () => resolve();
    });
    const addRow = action(function* (row: Row) {
      setView((draft) => {
        draft.push({ ...row });
      });
      yield serverOk;
      setBase((draft) => {
        draft.push({ ...row });
      });
    });
    const confirming = addRow({ id: "n1", name: "new", qty: 9 });
    flush();
    await microtasks();
    expect(calls.map((c) => c.kind)).toEqual(["sync"]);
    expect(calls[0]!.txn.add?.map((r) => (r as Row).id)).toEqual(["n1"]);

    resolveServer();
    await confirming;
    flush();
    await microtasks();
    // the settle swapped the handle but emitted NOTHING (no remove+add churn, no update)
    expect(calls).toHaveLength(1);

    // the projection was rebound to the base-backed handle: a post-settle field write
    // projects as a normal async update (a projection left on the dead overlay handle
    // would silently miss this — the latent pre-delta bug this design fixes)
    setBase((draft) => {
      draft[3]!.qty = 100;
    });
    flush();
    await microtasks();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.kind).toBe("async");
    expect(calls[1]!.txn.update).toEqual([{ id: "n1", name: "new", qty: 100 }]);
    dispose();
  });
});
