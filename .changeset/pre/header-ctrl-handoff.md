---
"@dschz/solid-ag-grid": patch
---

Fix: common runtime column changes could disconnect a column's header from the grid. These include moving a column, opening or closing a column group, replacing `columnDefs`, pinning or unpinning a column, and toggling floating filters. Later calls such as a sort, a resize, `deselectAll` or a `rowSelection` change then threw `TypeError: Cannot read properties of null (reading 'toggleCss')` (or `setAriaExpanded` / `getUserCompInstance`), and unmounting the grid could throw the same error. Column headers, group headers and floating filters now hand over to their new place the way `ag-grid-react` does: the old header is torn down before the new one connects. A new test runs these operations against vanilla AG Grid and requires matching output with no errors.
