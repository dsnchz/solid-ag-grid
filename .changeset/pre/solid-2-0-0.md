---
"@dschz/solid-ag-grid": patch
---

Solid 2.0.0. The `solid-js` and `@solidjs/web` peers move from `^2.0.0-rc.21` to `^2.0.0`. Developed and tested against 2.0.0.

- **Fix: JS cell renderers crashed in development builds on Solid 2.0.0-rc.22 and later.** Solid now runs ref callbacks like render-effect callbacks. Creating a computation inside one throws `PRIMITIVE_IN_EFFECT_CALLBACK`, and calling `onCleanup` inside one throws `CLEANUP_IN_FORBIDDEN_SCOPE`. A cell with a non-Solid `cellRenderer` set its renderer up from such a callback, so the grid threw while mounting those cells. This covered JS classes, `agSkeletonCellRenderer`, and `deferRender` loading renderers. The renderer's lifecycle now lives in a root that the cell owns and disposes on unmount. A renderer is still created only for cells that need one, and is destroyed when its cell unmounts.
- **`rowStore` on optimistic views:** an optimistic edit to one row is again a one-row `update` transaction. On Solid rc.14 – rc.21, every optimistic edit re-ran every row's capture; Solid 2.0.0-rc.22 fixed this.
- **Known Solid regression, rc.22 – 2.0.0 ([solidjs/solid#5007](https://github.com/solidjs/solid/issues/5007)):** on a `createOptimisticStore` view, optimistic structural writes (push, splice, reorder) are not painted until the action settles, and a failed action's revert is not projected. Optimistic field edits and base-store writes are unaffected.
