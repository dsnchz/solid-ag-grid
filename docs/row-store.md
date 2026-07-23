# Row store guide (`rowStore`)

Opt-in **declarative row data**: hand the grid a Solid array store — plain, or a `createOptimisticStore` view — and mutate the store. The adapter projects every change into **surgical grid transactions**: structural add/remove synchronously (instant optimistic paint), field updates through the grid's async batch. No `api.applyTransaction` calls, no row bookkeeping, and optimistic updates (including automatic revert-on-failure) work with zero adapter-specific code.

If you only remember one sentence:

> **You mutate the store; the adapter writes the grid. One writer per grid — pick declarative (`rowStore`) or imperative (transactions), never both.**

## The spec, by example

```tsx
import { action, createOptimisticStore, createStore } from "solid-js";
import { AgGridSolid } from "@dschz/solid-ag-grid";

type Row = { readonly id: string; readonly name: string; readonly qty: number };

const [rows, setRows] = createStore<Row[]>(initial);
const [optimisticRows, setOptimisticRows] = createOptimisticStore(rows);

// GENERATOR form — Solid 2.0's action() takes generators. Writes after a plain
// `await` escape the transaction envelope (the classic mistake); `yield` preserves it.
const addRow = action(function* (row: Row) {
  setOptimisticRows((draft) => {
    draft.push(row); // shows in the grid INSTANTLY
  });
  const saved = (yield api.post(row)) as Row; // the background write (the "post")
  setRows((draft) => {
    draft.push(saved); // confirm into the base store
  });
}); // failure → the overlay reverts → the adapter emits a remove: the row vanishes

<AgGridSolid rowStore={optimisticRows} getRowId={(p) => p.data.id} columnDefs={cols} />;
```

That is the whole integration. The optimistic transparency is free by construction: the adapter reads the store reactively, so an overlay apply and an overlay revert are just changes — the failure path emits a remove like any other.

## When NOT to use `rowStore`

**Imperative transactions stay first-class.** `rowStore` is a convenience projection, not a replacement — these are the cases where you should keep calling `api.applyTransaction` / `applyTransactionAsync` yourself:

1. **Streaming that needs backpressure authority.** The adapter's latency policy is fixed (structural changes sync, field updates through the grid's async batch). If a high-frequency feed needs _your_ coalescing policy — custom batch windows, `flushAsyncTransactions()` control, dropping intermediate frames — own the transactions.
2. **Memory at very large scale.** With `rowStore` the data is resident twice: in your store (reactive proxies) and in the grid's row model (plain snapshots). At very large row counts, imperative transactions avoid the store copy entirely.
3. **Non-clientSide row models.** `rowStore` targets the **client-side row model only**. Infinite, server-side, and viewport row models own their data pipelines — a store projection does not apply.
4. **Per-call transaction nuance.** `applyTransaction` gives you per-call control the adapter deliberately decides by policy: precise `addIndex` placement per call, controlling cell flashing per transaction, and so on. If you need that dial, stay imperative.
5. **Reorders are not projected.** Transactions cannot express moves: a pure reorder of the store diffs as "no structural change" and the grid keeps its own order. Use the grid's sorting for ordering — or imperative control if you truly need externally-imposed row order.

## Requirements & contract

- **`getRowId` is REQUIRED** — stable, **data-derived** ids. The supported pattern is **client-generated ids (e.g. `crypto.randomUUID()`) that the server persists**: the optimistic row and the confirmed row then share an identity, and the confirm diffs as a no-op instead of a remove+add flicker. Missing `getRowId` is a console error; the grid degrades to a static snapshot of the store.
- **Never mutate an id in place.** Keys are cached per row _handle_ — a row object whose id field is mutated keeps projecting under its old key. If a row's identity must change, remove it and add a new row.
- **Mutually exclusive with `rowData`.** Providing both is a console warning and `rowData` is ignored — the store drives row data. The store's identity is captured once, at grid creation, and is fixed for the grid's lifetime.
- **Client-side row model only** (see case 3 above).
- **One writer per grid.** Mixing imperative transactions (or `rowData` swaps via the API) with `rowStore` on the same grid is unsupported — the adapter's structural diff assumes it is the only author of the grid's row set.
- **The adapter never writes your store.** No id magic, no retries, no error interception, no edit-writeback (a cell edit via `setDataValue` does not flow back into the store). It only reads — plain snapshots cross the boundary, never proxies.
- **Settles are silent.** A confirm that lands the same data your optimistic write already showed is (by design) a no-op. If the server computes extra fields (timestamps, versions), write them into the base row _after_ the action resolves — a real field write projects as an update.

## The failure UX is a choice

What should happen to an optimistic row when the server write fails? That is a product decision, not a framework decision — both recipes below are canonical; pick per feature.

### Recipe A — vanish on failure (optimistic view + auto-revert)

The spec-by-example above. The row appears instantly from the overlay write; on failure the transition's overlay reverts, the adapter sees the row disappear from the view, and emits the remove. Surface the error out-of-band (a toast, a status line) from the caller:

```tsx
addRow(row).catch((e) => setLastError(e instanceof Error ? e.message : String(e)));
```

Choose this when a failed row should not linger — quick-add flows, ephemeral entries.

### Recipe B — persist with error status (base-store writes + status field)

No optimistic view at all: the row goes into the **base store** immediately — a real write that no revert can touch — carrying a `status` field, and failure flips the status instead of removing the row:

```tsx
type Row = { readonly id: string; name: string; qty: number; status: "saving" | "saved" | "error" };

const [rows, setRows] = createStore<Row[]>(initial);

const save = action(function* (row: Row) {
  yield api.post(row); // the process
  setRows((draft) => {
    const saved = draft.find((r) => r.id === row.id);
    if (saved) saved.status = "saved"; // field write → the adapter emits an update
  });
});

const submit = (input: { name: string; qty: number }) => {
  const row = { id: crypto.randomUUID(), ...input, status: "saving" as const };
  setRows((draft) => {
    draft.push(row); // real write, paints instantly — and survives failure
  });
  save(row).catch(() => {
    setRows((draft) => {
      const failed = draft.find((r) => r.id === row.id);
      if (failed) failed.status = "error";
    });
  });
};

<AgGridSolid rowStore={rows} getRowId={(p) => p.data.id} columnDefs={cols} />;
```

The `status` field is ordinary row data — render it with a status column, style it with `cellClassRules`, offer a "retry" cell renderer. Choose this when the user's input must not be lost — forms, order entry, anything with a retry story.

Note the initial push happens in the **event handler**, not inside the action: writes inside an action are transaction-coordinated and land at settle, which is exactly what you want for the _confirm_ ("saved") but the opposite of what you want for the instant "saving" row.

## Affordances: write state, don't probe it

Solid 2.0's division of labor (from the official cheatsheet): **optimistic writes _show_ the expected value, `affects` _pends_ data you know is changing but can't show yet, and process affordances ("saving…") are a co-written `createOptimistic(false)` flag — not `isPending`.**

### "Saving…" — the co-written flag

```tsx
const [saving, setSaving] = createOptimistic(false);

const addRow = action(function* (row: Row) {
  setSaving(true); // co-written with the optimistic write; auto-reverts at settle
  setOptimisticRows((draft) => {
    draft.push(row);
  });
  yield api.post(row);
  setRows((draft) => {
    draft.push(row);
  });
});

<Show when={saving()}>
  <em>saving…</em>
</Show>;
```

The flag reverts automatically when the transition settles — success or failure — because it is itself an optimistic write.

**Why not `isPending`?** Optimistic writes are _source-of-truth_, not pending — revealing immediately is their entire point, so probing the optimistic view with `isPending` reads `false` forever. In get/post terms: `isPending` is a **get-side** tool — it answers "is a value _change_ still propagating to this read?" — while "saving…" is a **post-side** fact, the status of a process the user started. Model process status as state you _write_ (the co-written flag, a status field), not state you probe.

### Per-row status tags

Two forms, matching the two recipes:

- **Base-store grids (Recipe B):** the `status` field on the row _is_ the tag — written like any other field, rendered like any other column.
- **Optimistic-view grids (Recipe A):** derive it — a row is "saving" while it is visible in the optimistic view but not yet confirmed into the base store. A cell renderer can read your app store directly (that is [doorway 2](./reactivity.md#doorway-2-around-the-grid-into-your-components)):

  ```tsx
  const StatusCell = (props: ICellRendererParams<Row>) => {
    const confirmed = createMemo(() => rows.some((r) => r.id === props.data?.id));
    return (
      <Show when={confirmed()} fallback={<em>saving…</em>}>
        saved
      </Show>
    );
  };
  ```

  Keep the tag _out_ of the row data in this recipe — the settle is silent (see the contract), so a tag field written only optimistically would not clear in the grid at confirm.

### `affects` — pend data you know will change

When the server will change data you _can't_ show optimistically (a server-computed `updatedAt`, a recalculated total), declare it — reads of that data then participate in `isPending` until the action settles:

```tsx
const rename = action(function* (todo, text) {
  setOptimisticTodos(() => {
    todo.text = text;
  });
  affects(todo, "updatedAt"); // the server changes this slot too — pend it
  yield api.rename(todo.id, text);
  refresh(todos);
});
```

`affects` is for _data you know is changing but can't show yet_ — it is not a "saving…" mechanism.

## Both store forms

### View over a base store — `createOptimisticStore(rows)`

The form used throughout this guide's Recipe A: your app owns the canonical row array locally, actions confirm into it. Choose it when the client is the working source of truth and server writes are persistence.

### Derived from a source — `createOptimisticStore(() => api.list(), [])`

The canonical form for **server-owned data**: the store derives from an async source, optimistic writes overlay it, and after the server write you re-ask the source instead of maintaining a local copy:

```tsx
const [todos, setOptimisticTodos] = createOptimisticStore(() => api.list(), []);

const addTodo = action(function* (todo) {
  setOptimisticTodos((s) => {
    s.push(todo);
  }); // optimistic write — shows the expected value; never reads as pending itself
  yield api.add(todo); // async work
  refresh(todos); // reconcile with source of truth (quiet — same question)
});

<AgGridSolid rowStore={todos} getRowId={(p) => p.data.id} columnDefs={cols} />;
```

The grid boots from the initial value (`[]` → empty grid) and the resolved list arrives as structural adds. A bare `refresh()` re-asks the _same_ question and reveals silently — no overlay flash, and with stable ids the reconciled rows diff as no-ops or field updates, never as churn.

**Read-only companion:** for a server-driven grid with no writes at all, `createProjection(async () => api.list(), [], { key: "id" })` pairs naturally with `rowStore` — keyed reconciliation preserves row identity across refetches, so the adapter projects only genuine deltas.

## Performance: delta capture

The adapter does per-row work, not per-array work:

- **Field updates are O(1) per changed row.** Each row gets its own projection; the changed row's plain payload is captured at invalidation time and batched — one `applyTransactionAsync` call per microtask, no array walk.
- **Structural changes are mapArray-grade** (the same profile as `<For>`): an O(n) pointer-identity walk over row handles, with the heavy work — snapshotting, key derivation, projection lifecycle — running only for the O(delta) rows that actually changed.
- **Boot is one whole-array snapshot** — every row is needed once anyway.

Measured (informational browser benchmark, 10,000 rows, real Chromium — `test/browser/rowStorePerf.browser.test.tsx`): a single-row **add** paints in **~15 ms** store-write→painted-row; a single-row **field update** paints in **~58 ms** store-write→painted-cell — a figure that _includes_ the grid's own `applyTransactionAsync` batching window (~50 ms by default), i.e. it is dominated by the grid's deliberate batching, not adapter CPU. The same benchmark asserts the updates are surgical: every other rendered row keeps its exact DOM elements.

> **Requires `solid-js` >= 2.0.0-beta.24.** Delta capture relies on per-item `snapshot(row)` / `deep(row)` returning plain data even on derived optimistic views — guaranteed since beta.24's snapshot fix (earlier betas could leak a live proxy across the boundary). This package pins and tests against beta.24.

## See also

- [Reactivity guide](./reactivity.md) — the two-doorway model and footgun catalog; `rowStore` is the opt-in third way in.
- [README — What Solid rendering buys you](../README.md#what-solid-rendering-buys-you)
- The dev playground's "rowStore optimistic CRUD" scenario (`dev-playground/index.tsx`) — Recipe A end-to-end against a simulated flaky server, with the co-written saving flag.
