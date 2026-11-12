---
"@dschz/solid-ag-grid": patch
---

Faster scrolling: each mounted cell builds 9 reactive computations instead of 12. The `<Show keyed>` around a Solid cell renderer is now a single reactive insert, which still remounts the renderer only when its component or `renderKey` changes. Measured against the previous build in the production benchmark (interleaved, medians of 3):

- **Row swap** (the viewport replacement on scroll): 6.1 → 5.6 ms tall, 5.9 → 5.6 ms wide (vanilla AG Grid: 4.5 / 4.3).
- **Memory:** 71.9 → 67.2 KB allocated per swap.

Initial render and streaming value ticks are unchanged. No behavior change: a value update still reaches the mounted renderer without remounting it, and `refresh()` returning `false` still forces a remount.
