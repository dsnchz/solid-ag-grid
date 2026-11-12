---
"@dschz/solid-ag-grid": patch
---

Faster scrolling: each mounted cell builds 12 reactive computations instead of 23. Three `<Show>` blocks per cell had conditions that are plain signals the grid controller writes. Value visibility is now folded into reads the cell already makes, and the editor branch and the wrapper decision are one reactive insert each.

Measured against vanilla AG Grid in the production benchmark (interleaved, medians of 3):

- **Row swap** (the viewport replacement on scroll): 6.2 → 5.5 ms tall (vanilla 4.1) and 6.1 → 5.4 ms wide (vanilla 4.0), about a third less overhead than vanilla.
- **Memory:** 92 → 73 KB allocated per swap.
- **Custom-cell streaming ticks:** 0.93 → 0.80 ms.

No behavior change; every parity suite is unchanged.
