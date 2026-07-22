import type { GridApi } from "ag-grid-community";
import {
  $PROXY,
  $TRACK,
  createEffect,
  createRoot,
  deep,
  getOwner,
  onCleanup,
  runWithOwner,
  snapshot,
  untrack,
} from "solid-js";

// T6 STORE→TRANSACTION ADAPTER (design: .agent/planning/tasks/T6-row-store-adapter.md).
// The user mutates a Solid array store (plain or optimistic view); the adapter projects the
// changes into surgical grid transactions. Approved decisions baked in:
// 1. Identity: stable client-generated ids are the supported pattern — the prev-keys map diffs
//    by getRowId, so an id that changes across an optimistic confirm reads as remove+add.
// 2. Latency policy is FIXED: structural add/remove via sync applyTransaction (instant
//    optimistic paint, same task as the store write's flush); field updates via
//    applyTransactionAsync (the grid batches them, stream-friendly).
// 3. Surface is the `rowStore` prop (wired from agGridSolid.tsx) — boot seeding, ready
//    queueing and cleanup come from the grid lifecycle with zero user wiring.
// Optimistic transparency is free by construction: the projections read reactively, so an
// overlay revert is just another change (the failure path emits a remove like any other).
// Out of scope v1 (per design doc): edit-writeback (setDataValue → store), reconcileIds,
// store reorders (transactions cannot express moves; a pure reorder diffs as no change and
// the grid keeps its own order — use grid sorting).

// PROXY-LEAK GUARD — CONFIRMED REPRODUCIBLE (solid-js 2.0.0-beta.21, re-verified
// 2026-07-22 by removing this guard: the flagship optimistic browser test goes red with
// 18+ STRICT_READ_UNTRACKED warnings from the grid core's own reads of leaked rows).
// Trigger: the full optimistic lifecycle over a view-of-a-store (rows pushed via the
// optimistic setter and confirmed into the base) leaves row nodes whose STORE_VALUE is the
// inner store proxy; snapshotImpl's no-override fast path then returns that proxy verbatim
// (top-level only — child unwraps copy). A minimal fresh-store case does NOT reproduce;
// the lifecycle state is required. Re-snapshotting until no $PROXY remains yields plain
// data; untrack marks these reads deliberately non-subscribing. Pinned by the never-proxy
// assertions in test/unit/rowStoreAdapter.test.tsx AND by the flagship test's console spy.
// TODO(upstream): standalone repro + issue against solidjs/solid — tracked in STATUS.
export const plainSnapshot = <V>(value: V): V =>
  untrack(() => {
    let out: unknown = snapshot(value);
    while (
      out !== null &&
      typeof out === "object" &&
      (out as { readonly [key: symbol]: unknown })[$PROXY] !== undefined
    ) {
      out = snapshot(out);
    }
    return out as V;
  });

export type RowStoreAdapterParams<TData> = {
  /** The user's array store proxy. The adapter only reads it — never writes. */
  readonly store: readonly TData[];
  /**
   * The user's getRowId wrapped to a data-only key function (string-coerced like the core's
   * _getRowIdCallback). Must derive the id from `data` alone — the adapter has no row node.
   */
  readonly getRowKey: (data: TData) => string;
  /** Accessor for the GridApi — undefined until boot; emissions are ready-gated anyway. */
  readonly getApi: () => GridApi<TData> | undefined;
  /**
   * ReadyQueue gate (same one the prop-diff effect uses). Transactions emitted before the
   * grid is ready are queued and replayed in arrival order at drainAndMarkReady — necessary
   * because a transaction applied to the core before the client-side row model has started
   * returns null and is silently dropped (see the note on `emit` below).
   */
  readonly processWhenReady: (fn: () => void) => void;
};

export type RowStoreAdapter<TData> = {
  /**
   * Plain snapshot of the store taken at adapter creation — inject as the boot `rowData`.
   * The structural diff below starts from this exact baseline, so mutations landing between
   * adapter creation and grid readiness replay as queued transactions with no double-apply.
   */
  readonly seedRows: readonly TData[];
};

type RowEntry<TData> = {
  /** Snapshot from the last structural pass — the remove-transaction payload (id fields are
   * what matter; with stable ids a stale copy still targets the right node). */
  snap: TData;
  /** Disposes the row's field projection. null = seeded pre-mount, projection not built yet. */
  dispose: (() => void) | null;
};

export const createRowStoreAdapter = <TData>(
  params: RowStoreAdapterParams<TData>,
): RowStoreAdapter<TData> => {
  const { store, getRowKey, getApi, processWhenReady } = params;

  // Bookkeeping is plain mutables by doctrine (ARCHITECTURE §5.1 corollary, cf. readyQueue):
  // machinery state, not rendering state — nothing derives from it, and the structural apply
  // needs read-after-write immediacy within a single flush.
  const entries = new Map<string, RowEntry<TData>>();
  const pendingUpdates = new Map<string, TData>();
  let updateFlushQueued = false;
  let disposed = false;

  // owner captured in the component body: per-row projection roots are created later, inside
  // the structural effect's apply phase, and must not inherit that transient scope
  const owner = getOwner();

  const seedRows = plainSnapshot(store) as TData[];
  for (const data of seedRows) {
    entries.set(getRowKey(data), { snap: data, dispose: null });
  }

  onCleanup(() => {
    disposed = true;
    for (const entry of entries.values()) {
      entry.dispose?.();
    }
    entries.clear();
    pendingUpdates.clear();
  });

  // PRE-READY TRANSACTIONS ARE HAZARDOUS, NOT MERELY DROPPED — EMPIRICAL VERDICT (jsdom
  // probe against ag-grid-community 36.0.1, 2026-07-22): in the window between
  // GridCoreCreator.create and the accept-changes whenReady, api.applyTransaction APPLIES —
  // to a still-empty row model (the boot rowData seed has not landed yet) — and marks row
  // data as managed, after which the boot seed NEVER applies: probe with seed [a] + pre-ready
  // add [b] ended with final node set [b], seed lost. Pinned by "pre-ready store mutations"
  // in test/unit/rowStoreAdapter.test.tsx. Routing every emission through processWhenReady is
  // therefore load-bearing (queued, replayed in arrival order after the seed applies) and
  // also inherits the refresh-lock queueing the prop-diff effect already obeys.
  const emit = (fn: (api: GridApi<TData>) => void): void => {
    processWhenReady(() => {
      const api = getApi();
      if (api && !disposed) {
        fn(api);
      }
    });
  };

  // Field updates buffer for one microtask (this runs AFTER the whole reactive flush, so the
  // structural apply has already reconciled `entries` regardless of effect ordering) and are
  // then handed to applyTransactionAsync in a single call. The membership filter drops updates
  // for rows removed in the same flush — otherwise the grid would warn about an unknown id
  // when its async batch fires after our sync remove.
  const flushUpdates = (): void => {
    updateFlushQueued = false;
    if (disposed) {
      pendingUpdates.clear();
      return;
    }
    const update: TData[] = [];
    for (const [key, data] of pendingUpdates) {
      if (entries.has(key)) {
        update.push(data);
      }
    }
    pendingUpdates.clear();
    if (update.length > 0) {
      emit((api) => api.applyTransactionAsync({ update }));
    }
  };

  const scheduleUpdateFlush = (): void => {
    if (!updateFlushQueued) {
      updateFlushQueued = true;
      queueMicrotask(flushUpdates);
    }
  };

  const createRowProjection = (key: string, row: TData): (() => void) =>
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        // CATEGORY 1 EFFECT (§5.1: reactive → core push). Field projection: deep(row) yields a
        // plain deep copy AND subscribes to every nested property of THIS row only (store path
        // granularity) — the copy is the snapshot that crosses the grid boundary (§7.8: never
        // proxies; the grid owns the data it is handed).
        createEffect(
          () => deep(row as TData & object),
          (plain, prev) => {
            if (prev === undefined) {
              // first run only establishes tracking — the add transaction (or boot seed)
              // already carried this exact data
              return;
            }
            // deep() has the same top-level proxy-leak fast path as snapshot() (verdict on
            // plainSnapshot above) — never let a proxy cross the boundary
            pendingUpdates.set(key, plainSnapshot(plain));
            scheduleUpdateFlush();
          },
        );
        return dispose;
      }),
    );

  // CATEGORY 1 EFFECT (§5.1: reactive → core push). Structural projection: the compute reads
  // only the array's structure — $TRACK (self-node: index add/remove) plus length and every
  // index identity via .map. Row FIELD writes notify the row's own nodes, not these, so field
  // churn never re-runs this compute. The apply diffs against the prev-keys map and emits
  // sync add/remove transactions (latency policy: structural = instant paint).
  createEffect(
    () => {
      void (store as unknown as { readonly [key: symbol]: unknown })[$TRACK];
      return store.map((row) => row);
    },
    (rows) => {
      const nextKeys = new Set<string>();
      const adds: { readonly data: TData; readonly index: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as TData;
        // plainSnapshot reads through the store's overlay layers without subscribing — it
        // sees optimistic values exactly as the user does (guard rationale: verdict above)
        const data = plainSnapshot(row);
        const key = getRowKey(data);
        nextKeys.add(key);
        const entry = entries.get(key);
        if (entry) {
          entry.snap = data;
          if (entry.dispose === null) {
            // seeded pre-mount: attach the field projection on first sight of the live proxy
            entry.dispose = createRowProjection(key, row);
          }
        } else {
          adds.push({ data, index: i });
          entries.set(key, { snap: data, dispose: createRowProjection(key, row) });
        }
      }

      const removes: TData[] = [];
      for (const [key, entry] of entries) {
        if (!nextKeys.has(key)) {
          removes.push(entry.snap);
          entry.dispose?.();
          entries.delete(key);
          // a same-flush field write on a removed row must not survive as an async update
          pendingUpdates.delete(key);
        }
      }

      if (removes.length === 0 && adds.length === 0) {
        return;
      }

      // adds grouped into contiguous index runs, ascending: applyTransaction takes ONE
      // addIndex per call, and inserting runs in ascending order keeps each run's store
      // position valid as the earlier runs land
      const runs: { readonly start: number; readonly data: TData[] }[] = [];
      for (const add of adds) {
        const last = runs[runs.length - 1];
        if (last && add.index === last.start + last.data.length) {
          last.data.push(add.data);
        } else {
          runs.push({ start: add.index, data: [add.data] });
        }
      }

      emit((api) => {
        if (removes.length > 0) {
          api.applyTransaction({ remove: removes });
        }
        for (const run of runs) {
          api.applyTransaction({ add: run.data, addIndex: run.start });
        }
      });
    },
  );

  return { seedRows };
};
