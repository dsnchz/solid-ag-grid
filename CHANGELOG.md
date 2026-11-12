# @dschz/solid-ag-grid

## 36.0.0-next.8

### Patch Changes

- dcf66ff: Fix: common runtime column changes could disconnect a column's header from the grid. These include moving a column, opening or closing a column group, replacing `columnDefs`, pinning or unpinning a column, and toggling floating filters. Later calls such as a sort, a resize, `deselectAll` or a `rowSelection` change then threw `TypeError: Cannot read properties of null (reading 'toggleCss')` (or `setAriaExpanded` / `getUserCompInstance`), and unmounting the grid could throw the same error. Column headers, group headers and floating filters now hand over to their new place the way `ag-grid-react` does: the old header is torn down before the new one connects. A new test runs these operations against vanilla AG Grid and requires matching output with no errors.
- a5f4625: A cell value refresh no longer re-runs the cell's wrapper decision, its `ag-cell-value` visibility check or its renderer-identity check when none of them changed. Under heavy value streaming, Solid's dev diagnostics could report this as `WASTED_RECOMPUTE` on `showCellWrapper` or `frameworkRendererInfo`. A Solid-renderer cell now re-runs three reactive scopes per value tick instead of five. Measured rendering cost is unchanged.
- b69508c: Faster scrolling: each mounted cell builds 9 reactive computations instead of 12. The `<Show keyed>` around a Solid cell renderer is now a single reactive insert, which still remounts the renderer only when its component or `renderKey` changes. Measured against the previous build in the production benchmark (interleaved, medians of 3):

  - **Row swap** (the viewport replacement on scroll): 6.1 → 5.6 ms tall, 5.9 → 5.6 ms wide (vanilla AG Grid: 4.5 / 4.3).
  - **Memory:** 71.9 → 67.2 KB allocated per swap.

  Initial render and streaming value ticks are unchanged. No behavior change: a value update still reaches the mounted renderer without remounting it, and `refresh()` returning `false` still forces a remount.

- a279a71: Faster scrolling and initial render: each mounted row builds 10 reactive computations instead of 27. A row's layout (cell lanes or a full-width anchor) never changes while it is mounted, so it is now decided once. Each pinned lane appears and disappears on its own, so pinning a column on one side no longer touches the other side's cells. Measured against the previous build in the production benchmark (interleaved, medians of 3):

  - **Row swap** (the viewport replacement on scroll): 5.8 → 5.5 ms on a 10-column grid (vanilla AG Grid: 4.6).
  - **Initial render:** 46.9 → 44.1 ms (100k rows × 10 columns), 16.4 → 15.1 ms (20k × 100), now level with vanilla.
  - **Memory:** 67.2 → 62.8 KB allocated per swap.

## 36.0.0-next.7

### Patch Changes

- eb0c9b2: AG Grid 36.3.0. `36.0.0-next.6` failed to load against `ag-grid-community` 36.1 and later (the `^36.0.0` peer range let fresh installs resolve them): AG Grid 36.1 removed `_warn` and reshaped the controller contracts this renderer implements. This release is a port of `ag-grid-react` 36.0.1 → 36.3.0.

  **Breaking:** the `ag-grid-community` peer is now pinned to exactly `36.3.0`, and `ag-stack` to the same version, the way `ag-grid-react` pins it. AG Grid's internals are not semver-governed, so each AG Grid release is ported deliberately instead of being accepted by a range.

  `warnReactiveCustomComponents(gridId)` now takes the grid id, matching `ag-grid-react`.

  What the port brings over from AG Grid 36.1–36.3:

  - **New export:** `CustomColumnSelectionLabelProps`, for Solid column-selection label renderers (`columnLabelRenderer`). Solid `overlayComponent`s are also routed.
  - **Cells:** cell spanning via `cellSpan`. A removed or replaced cell renderer, or one whose `refresh()` forces a remount, no longer leaves its `setTooltip` registration behind. A JS cell editor that resolves after its edit session ends is destroyed instead of shown.
  - **Rows:** each pinned lane is fed directly by the row controller. Lanes keep the controller's DOM order (`ensureDomOrder`), and new cells are placed in column order. Pinned lane widths are written to the DOM as vanilla does. The per-row reactive graph drops from 32 to 27 computations.
  - **Grid shell and header:**
    - An aria description container is added.
    - Pinned columns that overflow are flagged (`ag-pinned-columns-overflow`).
    - The header, top and bottom row heights are published as viewport CSS variables.
    - Header rows partition by pinned lane, and their tab index is controller-driven.
    - Detail grids no longer re-apply theme classes inside their master's styled root.
  - **Props:** removing an event-handler prop (for example `onCellClicked`) now unregisters it. A handler that is only pending (async) keeps its value.
  - **Custom components:**
    - Tool panels restore `initialState`.
    - Floating filters set a provided filter's model without the deprecation warning.
    - Wrappers carry AG Grid's theme hook classes (`ag-react-container`, plus `ag-react-wrapper-block` when the component type requires it), so the toolbar layout rules apply to Solid components.

- 6625161: Faster scrolling: each mounted cell builds 12 reactive computations instead of 23. Three `<Show>` blocks per cell had conditions that are plain signals the grid controller writes. Value visibility is now folded into reads the cell already makes, and the editor branch and the wrapper decision are one reactive insert each.

  Measured against vanilla AG Grid in the production benchmark (interleaved, medians of 3):

  - **Row swap** (the viewport replacement on scroll): 6.2 → 5.5 ms tall (vanilla 4.1) and 6.1 → 5.4 ms wide (vanilla 4.0). The overhead over vanilla drops from about 50% to about 30–35%.
  - **Memory:** 92 → 73 KB allocated per swap.
  - **Custom-cell streaming ticks:** 0.93 → 0.80 ms.

  No behavior change; every parity suite is unchanged.

- 9a967f3: Column-resize operations queued after data events (the `autoSizeColumns`-from-an-event-handler DX) now drain through one timer per macrotask instead of one per updated row: a 500-row update transaction scheduled 501 timers and 500 macrotask turns per tick. Streaming ticks reaching custom cell renderers dropped from x1.50 to x1.29 (lean) and x1.59 to x1.41 (rich) of vanilla.
- b9910fa: Solid 2.0.0-rc.21. The peer floor for `solid-js` and `@solidjs/web` moves from `^2.0.0-rc.7` to `^2.0.0-rc.21`.

  - **`rowStore` on optimistic views:** the per-key tracking fallback is removed. `deep()` over `createOptimisticStore` views hears base-store writes again (solidjs/solid#3323, fixed in rc.8), so optimistic grids get the same one-witness-per-row memory profile as plain stores, and structural optimistic writes cost O(delta). The dev-only `console.info` about per-key tracking is gone with it.
  - **Known Solid regression, rc.14 – rc.21:** an optimistic edit to one row re-runs every row's capture, so the grid receives the whole store as one `update` batch. The data stays correct; only the batch is larger. Plain stores are unaffected. It is fixed on Solid's `next` branch (solidjs/solid#4729) but not yet released. See `docs/row-store.md`.

- 43fa1d7: `rowStore`: the adapter's structural effect now subscribes to the array's `$TRACK` node alone instead of tracking every index, so a 100k-row store no longer materializes 100k index nodes per structural pass (dev-build medians: adapter boot 338 → 282 ms, structural pass 106 → 82 ms, dispose 29 → 17 ms). The store rule it rests on — arrays bump `$TRACK` on any index or length change and never on a field write, read through optimistic views — is pinned per operation in the delta tests.

## 36.0.0-next.6

### Minor Changes

- Solid 2.0.0-rc.7, a per-cell reactive diet measured by a graph budget, a `rowStore` fallback for an upstream store regression, and a benchmark harness that can see the renderer.

  - **Solid 2.0.0-rc.7.** Developed and tested against `solid-js` / `@solidjs/web` 2.0.0-rc.7; the peer floor moves to `^2.0.0-rc.7` (the rc.1 store rewrite changed optimistic-view semantics, and rc.4–rc.6 carry array-move corruption fixed in rc.7).
  - **`rowStore` on optimistic views.** On Solid rc.1 through rc.7, `deep()` over a `createOptimisticStore` view never wakes on base-store writes ([solidjs/solid#3323](https://github.com/solidjs/solid/issues/3323), fixed upstream for rc.8). The adapter detects an optimistic view and switches that store to per-key tracking — correct at every depth, higher memory per row (a one-time `console.info` names the trade in development); plain stores are unaffected. The structural diff also rebinds a row's projection on any handle change, so overlay/revert cycles never leave a projection on a stale proxy. The branch is removed at rc.8.
  - **Per-cell reactive diet.** Reactive nodes per mounted cell: 41 computations / 11 signals → 23 / 11; per row: 40 / 11 → 32 / 5, every parity suite green. Editing CSS classes are written at the write sites instead of an always-on effect; the JS-editor, tool-widget and renderer-refresh lifecycles live in the `Show` branch that owns their state; row index/id/business-key, top/transform and user row/cell styles are direct element writes from the proxy setter (as vanilla does); JS-renderer machinery is created lazily; `renderDetails` is three signals so a value tick touches only the text insert; row full-width effects exist only for full-width rows. `test/unit/reactiveGraphBudget.test.tsx` pins the counts.
  - **Fixes.** The deferred editor-attach turn bails when the edit session already ended (a `TypeError` in the core's tooltip feature when editing started and stopped within one tick). Async grid-option props probe with `isPending()`; the narrow `NotReadyError` catch remains only for never-resolved sources, where Solid's own probe rethrows by rule.
  - **Benchmarks.** The perf suite runs in a production posture (`pnpm test:perf`, weekly workflow) and reports CPU inside the reactive settle next to paint-to-paint, with median/p95/worst and a row-swap metric. Current numbers vs vanilla: initial render ~1.02–1.07×, transactions parity, row swap ~1.2–1.5×.
  - **JSR.** Also published as TypeScript source: `npx jsr add @dschz/solid-ag-grid`. Every public symbol carries JSDoc.
