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
//    (Delta corollary: keys are cached per row HANDLE, so mutating the id field of a row
//    already in the store is out of contract — it would keep projecting under the old key.)
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

// CLEAN-FORM DISCIPLINE + DELTA CAPTURE: on solid-js >= 2.0.0-beta.24 the per-item forms
// `snapshot(row)` / `deep(row)` are guaranteed plain even on derived optimistic views —
// the ≤ beta.21 leak (snapshot's no-override fast path returned the base store's live row
// proxy; reported by Daniel on the Solid Discord) was fixed upstream in solidjs/solid@a5fe9fb.
// That guarantee unblocks O(delta) capture, so this module does per-item work everywhere and
// keeps ONE whole-array `snapshot(store)` — at seed, where every row is needed anyway:
// - FIELD path, O(1)/changed row: each row projection's compute is `deep(row)`, which both
//   subscribes to every nested property of that row AND returns a plain deep copy. That
//   return IS the payload, captured at invalidation time into `pendingUpdates`
//   (last-write-wins per key); the microtask flush hands the map's values straight to
//   applyTransactionAsync — no array walk.
// - STRUCTURAL path, mapArray-grade (the same O(n)-pointer-walk profile as <For>): row
//   handles are identity-stable across moves/splices/optimistic reverts (probe test:
//   "row handles are identity-stable"), so the apply pointer-diffs the new handle array
//   against the previous pass (positional `===` fast path + a WeakMap for moved handles)
//   and runs `snapshot(row)` + getRowKey ONLY on genuinely new/changed handles. The one
//   identity break — an optimistic settle-confirm swaps the overlay handle for the
//   base-backed one — is detected by the same diff and handled by REBINDING that row's
//   field projection (the old overlay handle's store nodes go dead at settle; a projection
//   left on it would miss every later field write).
// The never-proxy assertions in test/unit/rowStoreAdapter.test.tsx and the flagship console
// spy remain the detectors for any regression of the upstream guarantee.

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
  /** Plain snapshot from when this row's handle was last new/changed — the remove-transaction
   * payload (id fields are what matter; with stable ids a stale copy still targets the right
   * node). Unchanged handles deliberately keep it (delta discipline). */
  snap: TData;
  /** The live row proxy the field projection is bound to. null = seeded pre-mount — the
   * projection attaches (and the handle fills in) on first sight of the live proxy. */
  handle: (TData & object) | null;
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
  // invalidation-time field capture: key → the row's latest plain payload (deep(row)'s
  // return), last-write-wins; the flush drains the map with no array walk
  const pendingUpdates = new Map<string, TData>();
  let updateFlushQueued = false;
  let disposed = false;

  // structural delta state: the previous pass's row handles and their keys (parallel arrays
  // for the positional === fast path), plus handle→key for handles that merely moved. The
  // WeakMap survives remove/re-add of the same object — the entry membership check below
  // makes that case re-run the heavy path, and stable ids make the cached key still correct.
  let prevHandles: readonly TData[] = [];
  let prevKeys: readonly string[] = [];
  const handleKeys = new WeakMap<TData & object, string>();

  // owner captured in the component body: per-row projection roots are created later, inside
  // the structural effect's apply phase, and must not inherit that transient scope
  const owner = getOwner();

  // seed: the ONE whole-array snapshot in the module (every row is needed here anyway).
  // untrack: deliberately non-subscribing read (payload capture, not a dependency).
  const seedRows = untrack(() => snapshot(store)) as readonly TData[];
  for (const data of seedRows) {
    entries.set(getRowKey(data), { snap: data, handle: null, dispose: null });
  }

  onCleanup(() => {
    disposed = true;
    for (const entry of entries.values()) {
      entry.dispose?.();
    }
    entries.clear();
    pendingUpdates.clear();
    prevHandles = [];
    prevKeys = [];
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

  const createRowProjection = (key: string, row: TData & object): (() => void) =>
    runWithOwner(owner, () =>
      createRoot((dispose) => {
        // CATEGORY 1 EFFECT (§5.1: reactive → core push). Field projection: deep(row)
        // subscribes to every nested property of THIS row only (store path granularity) AND
        // returns a plain deep copy — the payload, captured at invalidation time (O(1) per
        // changed row; last-write-wins per key across flushes within one microtask batch).
        // { defer: true } skips the initial run: the compute still establishes tracking, but
        // the add transaction (or boot seed) already carried this exact data.
        createEffect(
          () => deep(row),
          (plain) => {
            pendingUpdates.set(key, plain as TData);
            scheduleUpdateFlush();
          },
          { defer: true },
        );
        return dispose;
      }),
    );

  // CATEGORY 1 EFFECT (§5.1: reactive → core push). Structural projection: the compute reads
  // only the array's structure — $TRACK (self-node: index add/remove) plus length and every
  // index identity via .map. Row FIELD writes notify the row's own nodes, not these, so field
  // churn never re-runs this compute. The apply pointer-diffs the handle array against the
  // previous pass (see the module note): heavy work — snapshot(row) + getRowKey + projection
  // lifecycle — runs only for new/changed handles, then the key diff emits sync add/remove
  // transactions (latency policy: structural = instant paint). NOT deferred: the first apply
  // is load-bearing — it attaches projections to seeded entries and diffs any mutations that
  // landed between adapter creation and the first flush against the seed baseline.
  createEffect(
    () => {
      void (store as unknown as { readonly [key: symbol]: unknown })[$TRACK];
      return store.map((row) => row);
    },
    (rows) => {
      const keys = new Array<string>(rows.length);
      const nextKeys = new Set<string>();
      const adds: { readonly data: TData; readonly index: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as TData & object;
        // O(1) key recovery: same handle at the same position → last pass's key; a known
        // handle at a new position (splice shifted it) → the WeakMap's key
        let key = row === (prevHandles[i] as unknown) ? prevKeys[i]! : handleKeys.get(row);
        if (key === undefined || !entries.has(key)) {
          // O(delta) heavy path: genuinely new handle, a handle swap on an existing key, or
          // a previously-removed object re-added (known key, no entry)
          const data = untrack(() => snapshot(row)) as TData;
          if (key === undefined) {
            key = getRowKey(data);
            handleKeys.set(row, key);
          }
          const entry = entries.get(key);
          if (entry) {
            entry.snap = data;
            if (entry.handle !== row) {
              // handle swap for a live key: seeded pre-mount (handle null — attach on first
              // sight of the live proxy), or an optimistic settle-confirm replacing the
              // overlay proxy with the base-backed one. Rebind the field projection — the
              // old handle's store nodes go dead at settle, so a projection left on it
              // would miss every later field write. { defer: true } keeps the rebind
              // emission-free, preserving the settle-is-silent semantics.
              entry.dispose?.();
              entry.handle = row;
              entry.dispose = createRowProjection(key, row);
            }
          } else {
            adds.push({ data, index: i });
            entries.set(key, { snap: data, handle: row, dispose: createRowProjection(key, row) });
          }
        }
        keys[i] = key;
        nextKeys.add(key);
      }
      prevHandles = rows;
      prevKeys = keys;

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
