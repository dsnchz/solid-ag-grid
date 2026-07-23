<p>
  <img width="100%" src="https://assets.solidjs.com/banner?background=tiles&project=solid-ag-grid" alt="solid-ag-grid">
</p>

# @dschz/solid-ag-grid

**AG Grid v36 with 100% SolidJS rendering.**

Every header, row, and cell in the grid is rendered by Solid — this is a deep integration on the same architecture as `ag-grid-react`, not a thin wrapper around the JavaScript grid. Outside of AG Grid's own monorepo, this is the only framework-native AG Grid integration in existence.

![Image of AG Grid showing filtering and grouping enabled.](./github-grid-demo.jpg "AG Grid demo")

Because the rendering layer is Solid, your components are real Solid components living in the real reactive graph: cell renderers can read app signals and update with zero grid API calls, async data suspends into the grid's loading states, and refetches get stale-while-revalidate semantics for free.

> **Status: beta.** Targets **AG Grid v36** and **Solid 2.0 (beta)** only. Published under the `next` dist-tag until Solid 2.0 goes stable. See [Status & roadmap](#status--roadmap).

## Installation

```bash
npm install @dschz/solid-ag-grid ag-grid-community solid-js@2.0.0-beta.24 @solidjs/web@2.0.0-beta.24
# or
pnpm add @dschz/solid-ag-grid ag-grid-community solid-js@2.0.0-beta.24 @solidjs/web@2.0.0-beta.24
```

Peer dependencies:

| Package             | Version        | Notes                                                                                 |
| ------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `ag-grid-community` | `^36.0.0`      | The grid core. Our major always tracks AG Grid's major.                               |
| `solid-js`          | `2.0.0-beta.x` | **Solid 2.0 beta required — pin the exact beta version.** Solid 1.x is not supported. |
| `@solidjs/web`      | `2.0.0-beta.x` | Pin to the same beta as `solid-js`.                                                   |

Two things worth knowing:

- **Pin your Solid betas exactly** (no `^`). Solid 2.0 betas ship every few days and can change timing semantics; this package is developed and tested against a pinned beta (currently `2.0.0-beta.24`, which the `rowStore` adapter's delta capture also requires). We re-verify and bump deliberately.
- **`ag-stack`** (AG Grid's base package) is a regular dependency of both `ag-grid-community` and this package — it installs automatically; you never interact with it.

Your `tsconfig.json` / bundler must use Solid 2.0's JSX runtime:

```jsonc
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web",
  },
}
```

## Quick start

AG Grid v33+ requires registering the modules you use (or `AllCommunityModule` for everything). Themes are part of the [Theming API](https://www.ag-grid.com/javascript-data-grid/theming/) — no CSS imports needed by default.

```tsx
import { AgGridSolid } from "@dschz/solid-ag-grid";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const App = () => {
  const columnDefs = [{ field: "make" }, { field: "model" }, { field: "price" }];
  const rowData = [
    { make: "Toyota", model: "Celica", price: 35000 },
    { make: "Ford", model: "Mondeo", price: 32000 },
    { make: "Porsche", model: "Boxster", price: 72000 },
  ];

  return (
    <div style={{ height: "500px" }}>
      <AgGridSolid columnDefs={columnDefs} rowData={rowData} defaultColDef={{ flex: 1 }} />
    </div>
  );
};

export default App;
```

The grid fills its parent element, so give the parent a size. Modules can also be scoped instead of global: pass `modules={[...]}` to a single grid, or wrap a subtree in `<AgGridProvider modules={[...]}>` (which also accepts `licenseKey` for Enterprise).

Prefer the classic CSS-file themes? Set `theme="legacy"` and import the CSS as before:

```tsx
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

<div class="ag-theme-quartz" style={{ height: "500px" }}>
  <AgGridSolid theme="legacy" columnDefs={columnDefs} rowData={rowData} />
</div>;
```

## What Solid rendering buys you

These five capabilities exist because the grid's rendering is native Solid. None of them are possible in a wrapper.

### 1. Async row data, zero ceremony — with stale-while-revalidate refetches

Pass async-sourced data straight to `rowData`. While it's pending, the grid shows its loading overlay; when it resolves, rows appear. No `createResource` unwrapping, no loading flags:

```tsx
const [userId, setUserId] = createSignal(1);
const rows = createMemo(() => fetchRowsForUser(userId())); // returns a Promise

<AgGridSolid columnDefs={columnDefs} rowData={rows()} />;
```

And when `userId` changes and `rows` goes pending **again**, the grid keeps the previous rows visible until the new data resolves — no overlay flash, no blanking. Stale-while-revalidate is a guaranteed, test-pinned contract, and it falls out of the design: a pending prop is simply omitted from the change snapshot until it resolves.

Want explicit control? `loading={isPending(() => rows())}` drives the overlay by hand — safe in the grid prop position (the grid guards its own reads). But if you render an `isPending` indicator **yourself**, wrap that JSX in a `<Loading>` boundary: `isPending` rethrows while its source is uninitialized, and an unguarded read defers your whole tree's mount until the fetch settles. `loadingOverlayComponent` / `noRowsOverlayComponent` accept ordinary Solid components.

### 2. Async cell renderers

Cell renderers can read async computations directly. Each cell gets its own `<Loading>` boundary: pending cells show `colDef.loadingCellRenderer` (or the skeleton renderer), resolved cells reveal — independently, per cell:

```tsx
const PriceCell = (props: CustomCellRendererProps) => {
  const livePrice = createMemo(() => fetchLivePrice(props.value)); // async
  return <span>{livePrice()}</span>;
};

const columnDefs = [{ field: "ticker", cellRenderer: PriceCell, loadingCellRenderer: Spinner }];
```

Note: `agSkeletonCellRenderer` is not part of `AllCommunityModule` — provide your own `loadingCellRenderer` or register the module that ships it.

### 3. External signals just work inside grid components

Any component the grid creates for you — cell renderers, overlays, headers, tool panels — is mounted in your app's reactive graph. It can read any app signal and update live, with **zero** grid involvement:

```tsx
const [status, setStatus] = createSignal("connected");

const StatusOverlay = () => <div>status: {status()}</div>;

<AgGridSolid noRowsOverlayComponent={StatusOverlay} ... />;

// later, from anywhere in your app:
setStatus("reconnecting"); // the overlay inside the grid updates. That's it.
```

In React this class of problem requires an external store, because the grid's portal children are render-isolated from app state. In Solid, the JSX subscription _is_ the update path.

### 4. Reactive custom components via hooks

The full v36 reactive custom components system is ported: filters, floating filters, editors, date pickers, overlays, status panels, tool panels, menu items, and more — all as plain Solid components, with props **pushed into the live component** (no remount) when the grid refreshes them. Six hooks register your callbacks with the grid:

`useGridFilter` · `useGridFloatingFilter` · `useGridCellEditor` · `useGridDate` · `useGridMenuItem` · `useGridFilterDisplay`

```tsx
import { useGridFilter, type CustomFilterProps } from "@dschz/solid-ag-grid";

const MakeFilter = (props: CustomFilterProps) => {
  useGridFilter({
    doesFilterPass: (params) => props.model == null || params.data.make === props.model,
  });
  return (
    <div>
      <button onClick={() => props.onModelChange("Ford")}>only Ford</button>
      <button onClick={() => props.onModelChange(null)}>clear</button>
    </div>
  );
};

const columnDefs = [{ field: "make", filter: MakeFilter }];
```

Solid components run once, so the hooks register exactly once — no dependency arrays, no `useCallback`.

### 5. Declarative row data from a Solid store — optimistic CRUD with zero grid API calls

Opt in with the `rowStore` prop: hand the grid a Solid array store (plain, or a `createOptimisticStore` view) and just mutate the store. The adapter projects every mutation into surgical grid transactions — adds/removes paint synchronously, field updates ride the grid's async batch — and optimistic updates revert themselves on failure:

```tsx
const [rows, setRows] = createStore<Row[]>(initial);
const [optimisticRows, setOptimisticRows] = createOptimisticStore(rows);

const addRow = action(function* (row: Row) {
  setOptimisticRows((draft) => {
    draft.push(row); // shows in the grid INSTANTLY
  });
  const saved = (yield api.post(row)) as Row; // background write
  setRows((draft) => {
    draft.push(saved); // confirm into the base store
  });
}); // failure → the overlay reverts → the row vanishes from the grid by itself

<AgGridSolid rowStore={optimisticRows} getRowId={(p) => p.data.id} columnDefs={cols} />;
```

`getRowId` (stable, data-derived ids) is required; `rowStore` is mutually exclusive with `rowData` and targets the client-side row model. Imperative transactions remain first-class — the full guide, including the two failure-UX recipes, canonical "saving…" affordances, and **when NOT to use `rowStore`**, is in [docs/row-store.md](./docs/row-store.md).

## Reactivity doctrine: the grid tracks what it reads

The one-sentence model: **reactive data flows into the grid through options, around it into components — never through config.**

- **Into the grid, through options.** Every grid-option prop read from a signal is tracked; when it changes, the grid applies the change (`rowData={rows()}`, `columnDefs={cols()}`, `loading={busy()}`). Each prop is isolated — one pending or changing prop never stalls the others.
- **Around the grid, into components.** Your renderers/overlays/filters read app signals directly (capability 3). Don't route app state through the grid to reach your own components.
- **Never through config.** The objects _inside_ your options are handed to the imperative core and are not tracked. A signal read buried inside a `colDef`, `cellRendererParams`, or the `gridOptions` bag will not update the grid — change the option itself instead.

Footgun highlights (the full catalog with explanations lives in [docs/reactivity.md](./docs/reactivity.md)):

- **Spreading config works — if reactivity travels via getters.** `{...cfg}` preserves per-key isolation when the reactive keys are getters (`get rowData() { return data(); }`) or the whole config is a derived memo. A plain object literal that eagerly reads signals _looks identical_ and is frozen forever. This is the #1 spread bug.
- **Never destructure props or config.** Destructuring reads (and freezes) the values at that moment.
- **Reads after `await` never track.** In an async computation, read your signals _before_ the first `await`.
- **`gridOptions.context` is static.** It's a plain value handed to the core once — a signal read inside it won't propagate. Pass accessors (`context={{ userId }}` not `context={{ userId: userId() }}`) if components need live values.

## SSR

`AgGridSolid` is SSR-safe by contract: the server renders only the grid's shell divs, and the grid boots **exactly once, client-side, after hydration** — the same contract as `ag-grid-react` in Next.js. It works out of the box in **SolidStart** and **TanStack Start**; wrapping in `clientOnly()` is optional, not required.

This works because the package ships its Solid source via the `solid` export condition, letting Start frameworks compile it per environment.

> **Known limitation:** importing `dist/index.js` directly in Node (i.e. from a plain server context _without_ a Solid-aware bundler resolving the `solid` condition) throws — that file is client-compiled. Any Solid SSR setup uses the `solid` condition and is unaffected. Details and workarounds in [docs/ssr.md](./docs/ssr.md).

## Grid API

The `GridApi` arrives via `ref` once the grid UI is ready:

```tsx
import { AgGridSolid, type AgGridSolidRef } from "@dschz/solid-ag-grid";

const App = () => {
  let grid!: AgGridSolidRef;
  return (
    <div style={{ height: "500px" }}>
      <AgGridSolid ref={(r) => (grid = r)} columnDefs={cols} rowData={rows} />
      <button onClick={() => grid.api.selectAll()}>Select all</button>
    </div>
  );
};
```

## Docs

- [Reactivity guide](./docs/reactivity.md) — the full doctrine and footgun catalog.
- [Row store guide](./docs/row-store.md) — declarative row data via `rowStore`: the contract, both optimistic failure-UX recipes, canonical affordances, performance, and when NOT to use it.
- [SSR guide](./docs/ssr.md) — the SSR contract, framework setup, and the server-import limitation.
- AG Grid feature docs: [ag-grid.com](https://www.ag-grid.com/javascript-data-grid/getting-started/) — the grid core is identical across frameworks, so all feature documentation applies. Enterprise features require `ag-grid-enterprise` and a license.

## Status & roadmap

- **Beta**, tracking the Solid 2.0 beta line. Published under the `next` dist-tag; promoted to stable when Solid 2.0 is.
- **Versioning:** our major follows AG Grid's major — `36.x` supports AG Grid v36.
- **Tested:** 197 tests across three environments (real Chromium via Playwright, jsdom, and node SSR), with vanilla `createGrid` used as a behavioral parity oracle throughout.
- **Shipped:** the **store → transaction adapter** (opt-in [`rowStore`](./docs/row-store.md) prop) — feed the grid a Solid store and have mutations projected into surgical transactions, with transparent optimistic-update support and O(delta) capture (requires `solid-js` >= 2.0.0-beta.24).
- **Coming:**
  - **Expanded benchmarks** — published numbers for the adapter vs hand-written transactions vs naive row replacement (an informational 10k-row adapter benchmark already runs in CI).

## Credits

- The [AG Grid team](https://www.ag-grid.com/) — for the grid itself, and for an architecture that cleanly separates core logic from framework rendering, making integrations like this possible. This package's rendering layer is a port of `ag-grid-react` v36 (MIT).
- [Niall Crosby](https://github.com/ceolter) and [David Di Biase](https://github.com/davedbase) — authors of the original `solid-ag-grid` (v31), which this package revives.

## License

MIT — see [LICENSE](./LICENSE).
