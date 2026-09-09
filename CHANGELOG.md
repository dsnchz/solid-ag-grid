# @dschz/solid-ag-grid

## 36.0.0-next.6

### Minor Changes

- Solid 2.0.0-rc.7, a per-cell reactive diet measured by a graph budget, a `rowStore` fallback for an upstream store regression, and a benchmark harness that can see the renderer.

  - **Solid 2.0.0-rc.7.** Developed and tested against `solid-js` / `@solidjs/web` 2.0.0-rc.7; the peer floor moves to `^2.0.0-rc.7` (the rc.1 store rewrite changed optimistic-view semantics, and rc.4–rc.6 carry array-move corruption fixed in rc.7).
  - **`rowStore` on optimistic views.** On Solid rc.1 through rc.7, `deep()` over a `createOptimisticStore` view never wakes on base-store writes ([solidjs/solid#3323](https://github.com/solidjs/solid/issues/3323), fixed upstream for rc.8). The adapter detects an optimistic view and switches that store to per-key tracking — correct at every depth, higher memory per row (a one-time `console.info` names the trade in development); plain stores are unaffected. The structural diff also rebinds a row's projection on any handle change, so overlay/revert cycles never leave a projection on a stale proxy. The branch is removed at rc.8.
  - **Per-cell reactive diet.** Reactive nodes per mounted cell: 41 computations / 11 signals → 23 / 11; per row: 40 / 11 → 32 / 5, every parity suite green. Editing CSS classes are written at the write sites instead of an always-on effect; the JS-editor, tool-widget and renderer-refresh lifecycles live in the `Show` branch that owns their state; row index/id/business-key, top/transform and user row/cell styles are direct element writes from the proxy setter (as vanilla does); JS-renderer machinery is created lazily; `renderDetails` is three signals so a value tick touches only the text insert; row full-width effects exist only for full-width rows. `test/unit/reactiveGraphBudget.test.tsx` pins the counts.
  - **Fixes.** The deferred editor-attach turn bails when the edit session already ended (a `TypeError` in the core's tooltip feature when editing started and stopped within one tick). Async grid-option props probe with `isPending()`; the narrow `NotReadyError` catch remains only for never-resolved sources, where Solid's own probe rethrows by rule.
  - **Benchmarks.** The perf suite runs in a production posture (`pnpm test:perf`, weekly workflow) and reports CPU inside the reactive settle next to paint-to-paint, with median/p95/worst and a row-swap metric. Current numbers vs vanilla: initial render ~1.02–1.07×, transactions parity, row swap ~1.2–1.5×.
  - **JSR.** Also published as TypeScript source: `npx jsr add @dschz/solid-ag-grid`. Every public symbol carries JSDoc.
