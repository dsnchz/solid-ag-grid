// Export surface mirrors ag-grid-react v36 (reference/ag-grid-react-v36/src/index.ts).
// Deliberate deltas from the React package:
// - AgGridSolidRef: extra type export — React types its imperative handle as the AgGridReact
//   class itself; we have no class, so the `{ api }` ref shape needs a name.
// - InternalAgGridReactProps: omitted — React-internal plumbing (passGridApi) for their class
//   component wrapper; no Solid equivalent exists.
// - Deprecated AgGridReactProps members (maxComponentCreationTimeMs, setGridApi, children):
//   omitted — deprecated in v33.3 and never part of this package's API.
// - ModulesContext/LicenseContext: module-internal in both packages (not re-exported from the
//   React index either); consume them via <AgGridProvider>.
// - GroupCellRenderer/DetailCellRenderer: internal in both packages (registered as framework
//   components via SolidFrameworkOverrides, never exported).
export type { AgGridProviderProps } from "./agGridProvider";
export { AgGridProvider } from "./agGridProvider";
export type { AgGridSolidProps, AgGridSolidRef } from "./agGridSolid";
export { AgGridSolid, AgGridSolid as default } from "./agGridSolid";
// ag-grid-react parity: `CustomContext as CustomComponentContext` is public API
export { CustomContext as CustomComponentContext } from "./customComp/customContext";
export {
  useGridCellEditor,
  useGridDate,
  useGridFilter,
  useGridFilterDisplay,
  useGridFloatingFilter,
  useGridMenuItem,
} from "./customComp/hooks";
export type {
  CustomCellEditorCallbacks,
  CustomCellEditorProps,
  CustomCellRendererProps,
  CustomDateCallbacks,
  CustomDateProps,
  CustomDetailCellRendererProps,
  CustomDragAndDropImageProps,
  CustomExportingOverlayProps,
  CustomFilterCallbacks,
  CustomFilterDisplayCallbacks,
  CustomFilterDisplayProps,
  CustomFilterProps,
  CustomFloatingFilterCallbacks,
  CustomFloatingFilterDisplayProps,
  CustomFloatingFilterProps,
  CustomGroupCellRendererProps,
  CustomHeaderGroupProps,
  CustomHeaderProps,
  CustomInnerHeaderGroupProps,
  CustomInnerHeaderProps,
  CustomLoadingCellRendererProps,
  CustomLoadingOverlayProps,
  CustomMenuItemCallbacks,
  CustomMenuItemProps,
  CustomNoMatchingRowsOverlayProps,
  CustomNoRowsOverlayProps,
  CustomOverlayProps,
  CustomStatusPanelProps,
  CustomToolPanelProps,
  CustomTooltipProps,
} from "./customComp/interfaces";
export { getInstance, warnReactiveCustomComponents } from "./customComp/util";
