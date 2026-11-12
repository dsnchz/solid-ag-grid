---
"@dschz/solid-ag-grid": patch
---

AG Grid 36.3.0. `36.0.0-next.6` failed to load against `ag-grid-community` 36.1 and later (the `^36.0.0` peer range let fresh installs resolve them): AG Grid 36.1 removed `_warn` and reshaped the controller contracts this renderer implements. This release is a port of `ag-grid-react` 36.0.1 → 36.3.0.

**Breaking:** the `ag-grid-community` peer is now pinned to exactly `36.3.0`, and `ag-stack` to the same version, the way `ag-grid-react` pins it. AG Grid's internals are not semver-governed, so each AG Grid release is ported deliberately instead of being accepted by a range.

`warnReactiveCustomComponents(gridId)` now takes the grid id, matching `ag-grid-react`.

What the port brings over from AG Grid 36.1–36.3:

- **New export:** `CustomColumnSelectionLabelProps`, for Solid column-selection label renderers (`columnLabelRenderer`). Solid `overlayComponent`s are also routed.
- **Cells:** cell spanning via `cellSpan`. A removed or replaced cell renderer, or one whose `refresh()` forces a remount, no longer leaves its `setTooltip` registration behind. A JS cell editor that resolves after its edit session ends is destroyed instead of shown.
- **Rows:** each pinned lane is fed directly by the row controller. Lanes keep the controller's DOM order (`ensureDomOrder`), and new cells are placed in column order. Pinned lane widths are written to the DOM as vanilla does. The per-row reactive graph drops from 32 to 27 computations.
- **Grid shell and header:**
  - An aria description container is added.
  - Pinned columns that overflow are flagged (`ag-pinned-columns-overflow`).
  - The header, top and bottom row heights are published as viewport CSS variables.
  - Header rows partition by pinned lane, and their tab index is controller-driven.
  - Detail grids no longer re-apply theme classes inside their master's styled root.
- **Props:** removing an event-handler prop (for example `onCellClicked`) now unregisters it. A handler that is only pending (async) keeps its value.
- **Custom components:**
  - Tool panels restore `initialState`.
  - Floating filters set a provided filter's model without the deprecation warning.
  - Wrappers carry AG Grid's theme hook classes (`ag-react-container`, plus `ag-react-wrapper-block` when the component type requires it), so the toolbar layout rules apply to Solid components.
