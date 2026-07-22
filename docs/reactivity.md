# Reactivity guide

How `@dschz/solid-ag-grid` interacts with Solid's reactive graph, and the complete catalog of footguns to avoid. If you only remember one sentence:

> **Reactive data flows into the grid through options, around it into components — never through config.**

## The model

AG Grid's core is an imperative engine. This package renders every header, row, and cell with Solid, but the _engine_ still consumes plain values. The bridge between your reactive app and that engine has exactly two doorways:

### Doorway 1: through options (into the grid)

Every grid-option prop on `<AgGridSolid>` is read inside a tracked computation. If the value comes from a signal or memo, the read subscribes; when it changes, the component diffs the new value against the old and hands the change to the grid core:

```tsx
const [rows, setRows] = createSignal<Row[]>([]);
const cols = createMemo(() => buildColumns(mode()));

<AgGridSolid rowData={rows()} columnDefs={cols()} loading={busy()} />;
```

This is identity-diffed per key: to update `rowData`, produce a **new array** (as with every framework binding to AG Grid). Mutating an array in place is invisible.

**Per-key isolation.** Each prop is tracked and diffed independently. A change to `columnDefs` never re-applies `rowData`; a _pending_ async prop never stalls the others. This isolation is also what makes async data work (below).

### Doorway 2: around the grid (into your components)

Components the grid creates for you — cell renderers, overlays, headers, filters, tool panels, status panels — are mounted in **your** reactive graph. They can read any signal in your app and update live, with no grid involvement:

```tsx
const [connected, setConnected] = createSignal(true);

const ConnectionBadge = () => <span>{connected() ? "live" : "offline"}</span>;
// use as a cell renderer, overlay, header component... it just tracks.
```

Do not route app state through the grid (via `context`, params, or refresh calls) to reach your own components. Read it directly.

### The wall: config objects are not tracked

The _contents_ of your option objects — `colDef`s, `cellRendererParams`, `defaultColDef`, the `gridOptions` bag — are handed to the imperative core as plain data. A signal read buried inside one of them happens (at most) once, at merge time, and never again:

```tsx
// BROKEN: the signal read is inside a plain object; the core got a snapshot
const columnDefs = [{ field: "price", hide: hidePrice() }];

// CORRECT: make the OPTION reactive, not the config's innards
const columnDefs = createMemo(() => [{ field: "price", hide: hidePrice() }]);
<AgGridSolid columnDefs={columnDefs()} />;
```

The `gridOptions` prop specifically is **deliberately non-reactive**: it is merged once at grid creation (parity with every other AG Grid framework binding). Anything that should change over time belongs as a direct prop.

## Async data

### Zero-ceremony async rowData

Pass a pending value to any grid-option prop and the grid behaves sensibly. For `rowData`:

```tsx
const rows = createMemo(() => fetchRows(query())); // async — returns a Promise
<AgGridSolid rowData={rows()} />;
```

- **Initial load:** the pending key is simply absent from the creation snapshot → the grid boots with no rows and shows its loading overlay (customizable via `loadingOverlayComponent` — a Solid component that can read your app signals).
- **On resolve:** the tracked read already subscribed the prop-diff computation, so it re-runs and the data flows in as a normal option change.

### Stale-while-revalidate refetches — a guaranteed contract

When an already-loaded async prop goes pending _again_ (a refetch), the pending key is omitted from the change snapshot, so **no change is applied**: the grid keeps the previous rows, with no overlay flash and no blanking, until the new data resolves. This is pinned by a browser test and treated as a public contract, not an accident.

Need a refetch _indicator_? Drive it yourself — `loading={isPending(() => rows())}` shows the overlay during revalidation too (safe in the grid prop position — the grid guards its own reads). Rendering your own indicator? Wrap it in a `<Loading>` boundary: `isPending` **rethrows while the source is uninitialized**, and an unguarded read outside a boundary defers the entire root mount until the fetch settles (`ASYNC_OUTSIDE_LOADING_BOUNDARY`).

### Async cell renderers

Framework cell renderers may read async computations directly. Every cell body is wrapped in a `<Loading>` boundary whose fallback is `colDef.loadingCellRenderer` (or AG Grid's skeleton renderer, if you registered its module — note it is **not** in `AllCommunityModule`):

```tsx
const DetailCell = (props: CustomCellRendererProps) => {
  const detail = createMemo(() => fetchDetail(props.value)); // async
  return <span>{detail()}</span>;
};
```

Pending cells show the fallback independently; each reveals when its own data settles. Sync renderers pay nothing.

## The footgun catalog

### 1. Spread configs freeze unless reactivity travels via getters (the #1 spread bug)

`{...cfg}` onto `<AgGridSolid>` works and preserves per-key isolation — **if** the reactive keys are lazy:

```tsx
// CORRECT — getter defers the read to the tracked scope
const cfg = {
  columnDefs,
  get rowData() {
    return data();
  },
};
<AgGridSolid {...cfg} />;

// ALSO CORRECT — whole config derived
const cfg = createMemo(() => ({ columnDefs, rowData: data() }));
<AgGridSolid {...cfg()} />;

// BROKEN — looks identical, frozen forever: data() was read when the literal
// was evaluated, outside any tracked scope. The grid sees a plain value.
const cfg = { columnDefs, rowData: data() };
<AgGridSolid {...cfg} />;
```

The broken and correct versions are visually near-identical; when a spread grid "doesn't update," check for eager reads first.

### 2. Never destructure props or config

```tsx
// BROKEN — reads happen at destructure time and never again
const MyRenderer = ({ value, data }: CustomCellRendererProps) => <span>{value}</span>;

// CORRECT — property access on `props` stays live
const MyRenderer = (props: CustomCellRendererProps) => <span>{props.value}</span>;
```

This is standard Solid discipline; it applies equally to the grid's pushed props (filters, editors, overlays receive prop _pushes_ into the live component — destructuring severs them).

### 3. Reads after `await` never track

```tsx
const rows = createMemo(async () => {
  const data = await fetchRows(); // tracking ENDS at the first await
  return data.filter((r) => r.owner === userId()); // userId() will NEVER re-run this
});
```

Read every signal you depend on **before** the first `await` (e.g. `const uid = userId();` on line one). The advisory `solid-checker` tool flags this pattern as `reactive-read-after-await`.

### 4. `gridOptions.context` is static

The `context` grid option is a plain value delivered to the core once and passed around by reference. It is a great place for stable references (services, accessors), and a wrong place for point-in-time signal reads:

```tsx
// BROKEN — snapshot at creation
<AgGridSolid context={{ userId: userId() }} />

// CORRECT — pass the accessor; components call context.userId()
<AgGridSolid context={{ userId }} />
```

### 5. A context provider's `value` is not a tracking scope

If you build your own Solid contexts to share state with grid-created components (renderers, overlays), remember that Solid 2.0's provider `value` attribute is **not** tracked — a computed value passed there is frozen at provider creation (dev builds surface this as a `STRICT_READ_UNTRACKED` diagnostic):

```tsx
// BROKEN — merged() is read once, untracked, at provider creation
<MyContext value={merged()}>...</MyContext>

// CORRECT — provide the accessor; consumers read it in their own tracked scopes
<MyContext value={merged}>...</MyContext>
```

This package's own `AgGridProvider` follows the same rule internally (its contexts carry accessors).

### 6. Context defaults: `null` sentinels, not `undefined`

Also Solid 2.0: `useContext` **throws** when a context has no default and no provider — and treats an explicitly provided `undefined` value the same as "not provided." If you want "absent" to be representable, make the default (and the provided empty value) `null`:

```tsx
// BROKEN — useContext(Ctx) throws when unprovided; providing undefined also throws
const Ctx = createContext<Config>();

// CORRECT — null is a real value; consumers branch on it
const Ctx = createContext<Config | null>(null);
```

`AgGridProvider`'s `ModulesContext` uses exactly this rubric (`null` = "no provider in the tree").

### 7. Status panel params refresh without remount

Reactive custom components (status panels, filters, tool panels, ...) receive **prop pushes** when the grid refreshes them — same component instance, new props object. Two consequences:

- Read params via `props.x` in JSX (live), not in the component body (run-once snapshot).
- Component-body work runs exactly once per mount; per-refresh logic belongs in JSX/memos reading `props`, or in the registered callbacks.

## Why per-key isolation exists (design note)

Internally, the component reads every grid-option prop inside one diffing computation. Solid 2.0 async semantics mean a pending read throws `NotReadyError` — if that propagated, **one** pending prop would suspend the whole computation and stall _all_ option updates. Instead each key is read through a per-key guard: not-ready keys are omitted from the snapshot (the tracked read has already subscribed, so resolution re-runs the diff and the key flows in as a normal change). Three user-visible behaviors fall out of this single decision:

1. async `rowData` shows the loading overlay on first load (key absent at creation),
2. refetches are stale-while-revalidate (key absent from the change snapshot → no change applied),
3. a pending prop never blocks other props from updating.

## See also

- [SSR guide](./ssr.md)
- [README — What Solid rendering buys you](../README.md#what-solid-rendering-buys-you)

### Footgun 8: `onCleanup` inside `onSettled` halts the reactive system

Solid 1.x muscle memory says `onMount(() => { ...; onCleanup(teardown) })`. In
Solid 2.0, calling `onCleanup` inside `onSettled` throws
`CLEANUP_IN_FORBIDDEN_SCOPE` — and halts reactivity for the whole app. **Return
the cleanup function from `onSettled` instead:**

```tsx
onSettled(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id); // ✅ the 2.0 contract
});
```

This applies to any component in your app, not just grid components — but grid
apps hit it often (intervals feeding rowData, resize listeners around grids).

## Reactive CSS classes: jurisdiction map

Classes follow the same two-doorways doctrine as data:

- **The outer container is yours, fully reactive**: `class={mode() === "dark" ?
"grid-dark" : "grid-light"}` on `<AgGridSolid>` — theming installs on inner
  layers and never fights you. Same for `containerStyle`.
- **Grid-internal elements (rows/cells) take dynamic classes through the grid's
  API**: `rowClassRules` / `cellClassRules` / `rowClass` / `cellClass`. The core
  evaluates them and pushes through the ctrl path, where they compose with the
  grid's own feature classes instead of clobbering them (this wrapper's internal
  discipline exists precisely so your rule-driven classes survive re-renders).
  The rules objects are reactive props like any other option.
- **Inside your own components, anything goes** — cell renderers, overlays and
  headers own their DOM; `class={signal() ? "hot" : "cold"}` is plain Solid.
- **Timing nuance**: `cellClassRules` re-evaluate when the core refreshes those
  cells (data change, `api.refreshCells()`), not spontaneously on arbitrary app
  signals. Signal-driven classes on grid-internal elements → call
  `refreshCells()` from an effect, or better, own the element with a custom
  renderer. Never mutate classes on grid-owned elements from outside — true in
  vanilla and every wrapper.
