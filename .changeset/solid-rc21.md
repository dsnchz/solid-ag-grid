---
"@dschz/solid-ag-grid": patch
---

Solid 2.0.0-rc.21. The peer floor for `solid-js` and `@solidjs/web` moves from `^2.0.0-rc.7` to `^2.0.0-rc.21`.

- **`rowStore` on optimistic views:** the per-key tracking fallback is removed. `deep()` over `createOptimisticStore` views hears base-store writes again (solidjs/solid#3323, fixed in rc.8), so optimistic grids get the same one-witness-per-row memory profile as plain stores, and structural optimistic writes cost O(delta). The dev-only `console.info` about per-key tracking is gone with it.
- **Known Solid regression, rc.14 – rc.21:** an optimistic edit to one row re-runs every row's capture, so the grid receives the whole store as one `update` batch. The data stays correct; only the batch is larger. Plain stores are unaffected. It is fixed on Solid's `next` branch (solidjs/solid#4729) but not yet released. See `docs/row-store.md`.
- **Dev console:** while a never-loaded async grid prop is pending (for example `rowData={rows()}` on first load), Solid logs one `[CAUGHT_REACTIVE_READ]` warning per grid. This is expected, and grid behavior is unchanged: the loading overlay shows, then the data flows in when it resolves. Solid has no non-throwing readiness probe for that case yet (requested in solidjs/solid#4789). See `docs/reactivity.md`.
