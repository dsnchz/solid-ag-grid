---
"@dschz/solid-ag-grid": patch
---

A cell value refresh no longer re-runs the cell's wrapper decision, its `ag-cell-value` visibility check or its renderer-identity check when none of them changed. Under heavy value streaming, Solid's dev diagnostics could report this as `WASTED_RECOMPUTE` on `showCellWrapper` or `frameworkRendererInfo`. A Solid-renderer cell now re-runs three reactive scopes per value tick instead of five. Measured rendering cost is unchanged.
