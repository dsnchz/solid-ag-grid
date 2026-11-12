---
"@dschz/solid-ag-grid": patch
---

A cell value refresh no longer re-runs the cell's wrapper decision (and the `ag-cell-value` visibility check) when nothing about it changed. Under heavy value streaming, Solid's dev diagnostics could report this as `WASTED_RECOMPUTE` on `showCellWrapper`. A Solid-renderer cell now re-runs four reactive scopes per value tick instead of five. Measured rendering cost is unchanged.
