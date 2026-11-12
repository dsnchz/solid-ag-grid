---
"@dschz/solid-ag-grid": patch
---

Fix: pinning or unpinning a column at runtime (for example `api.applyColumnState({ state: [{ colId, pinned: null }] })`) could disconnect that column's header from the grid. The next column change (a resize, a sort, a column move) then threw `TypeError: Cannot read properties of null (reading 'toggleCss')`, and unmounting the grid could throw the same error. Column headers and group headers now hand over to their new pinned section the way `ag-grid-react` does: the old header is torn down before the new one connects.
