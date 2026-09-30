---
"@dschz/solid-ag-grid": patch
---

Solid 2.0.0-rc.11: the peer floor for `solid-js` and `@solidjs/web` is now `^2.0.0-rc.11`. The `rowStore` per-key tracking fallback for optimistic views is removed: `deep()` over `createOptimisticStore` views hears base-store writes again (solidjs/solid#3323, fixed in rc.8), so optimistic grids get the same one-witness-per-row memory profile as plain stores and structural optimistic writes are O(delta) again. The dev-only `console.info` about per-key tracking is gone with it.
