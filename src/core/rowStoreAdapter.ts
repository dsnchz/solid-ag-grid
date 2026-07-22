import type { GridApi } from "ag-grid-community";
import {
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

// CLEAN-FORM DISCIPLINE: every plain read in this module uses the WHOLE-ARRAY form —
// `plainRows(store)` — with payload capture batched to one array snapshot per structural
// pass / per update flush (cheaper than per-row snapshots). Historical note: on
// solid-js ≤ 2.0.0-beta.21, the per-item form `snapshot(view[i])` on a derived store view
// leaked the base store's live row proxy — reported by Daniel (Solid Discord) and fixed
// upstream same-day in solidjs/solid@a5fe9fb (lands beta.22+). The batched whole-array
// design is kept on its own merits; the never-proxy assertions in
// test/unit/rowStoreAdapter.test.tsx and the flagship console spy remain the detectors.
const plainRows = <TData>(store: readonly TData[]): TData[] =>
  // untrack: deliberately non-subscribing read (payload capture, not a dependency)
  untrack(() => snapshot(store)) as TData[];

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
  // field projections only mark keys dirty; payloads are captured at flush time from one
  // whole-array snapshot (clean form + one walk per batch; last-write-wins as before)
  const dirtyKeys = new Set<string>();
  let updateFlushQueued = false;
  let disposed = false;

  // owner captured in the component body: per-row projection roots are created later, inside
  // the structural effect's apply phase, and must not inherit that transient scope
  const owner = getOwner();

  const seedRows = plainRows(store);
  for (const data of seedRows) {
    entries.set(getRowKey(data), { snap: data, dispose: null });
  }

  onCleanup(() => {
    disposed = true;
    for (const entry of entries.values()) {
      entry.dispose?.();
    }
    entries.clear();
    dirtyKeys.clear();
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
      dirtyKeys.clear();
      return;
    }
    // one whole-array snapshot per flush: payload capture in the clean form (see module note)
    const rows = plainRows(store);
    const byKey = new Map<string, TData>();
    for (const data of rows) {
      byKey.set(getRowKey(data), data);
    }
    const update: TData[] = [];
    for (const key of dirtyKeys) {
      const data = byKey.get(key);
      if (data !== undefined && entries.has(key)) {
        update.push(data);
      }
    }
    dirtyKeys.clear();
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
        // CATEGORY 1 EFFECT (§5.1: reactive → core push). Field projection: deep(row)
        // subscribes to every nested property of THIS row only (store path granularity).
        // Its return value is used solely for the first-run check — the payload that crosses
        // the grid boundary is captured at flush time via the clean whole-array form.
        createEffect(
          () => deep(row as TData & object),
          (_plain, prev) => {
            if (prev === undefined) {
              // first run only establishes tracking — the add transaction (or boot seed)
              // already carried this exact data
              return;
            }
            // the compute's deep(row) is subscription only — payload capture happens at
            // flush time from a whole-array snapshot (clean form, see module note)
            dirtyKeys.add(key);
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
      // one whole-array snapshot per structural pass (clean form; indexes align with the
      // compute's rows — both read within the same flush)
      const plain = plainRows(store);
      const nextKeys = new Set<string>();
      const adds: { readonly data: TData; readonly index: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as TData;
        const data = plain[i] as TData;
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
          dirtyKeys.delete(key);
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
