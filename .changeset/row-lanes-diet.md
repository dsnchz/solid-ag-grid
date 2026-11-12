---
"@dschz/solid-ag-grid": patch
---

Faster scrolling and initial render: each mounted row builds 10 reactive computations instead of 27. A row's layout (cell lanes or a full-width anchor) never changes while it is mounted, so it is now decided once. Each pinned lane appears and disappears on its own, so pinning a column on one side no longer touches the other side's cells. Measured against the previous build in the production benchmark (interleaved, medians of 3):

- **Row swap** (the viewport replacement on scroll): 5.8 → 5.5 ms on a 10-column grid (vanilla AG Grid: 4.6).
- **Initial render:** 46.9 → 44.1 ms (100k rows × 10 columns), 16.4 → 15.1 ms (20k × 100), now level with vanilla.
- **Memory:** 67.2 → 62.8 KB allocated per swap.
