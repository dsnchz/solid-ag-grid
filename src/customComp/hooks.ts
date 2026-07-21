import { useContext } from "solid-js";

import { CustomContext } from "./customContext";
import type {
  CustomCellEditorCallbacks,
  CustomDateCallbacks,
  CustomFilterCallbacks,
  CustomFilterDisplayCallbacks,
  CustomFloatingFilterCallbacks,
  CustomMenuItemCallbacks,
} from "./interfaces";

// Port of the React hooks at the bottom of shared/customComp/interfaces.ts. Solid components
// run once, so calling these in the component body registers the callbacks exactly once —
// no dependency-array ceremony needed.

function useGridCustomComponent<M>(methods: M): void {
  const { setMethods } = useContext(CustomContext);
  setMethods(methods);
}

/** Hook to allow custom cell editor component callbacks to be provided to the grid */
export function useGridCellEditor(callbacks: CustomCellEditorCallbacks): void {
  useGridCustomComponent(callbacks);
}

/** Hook to allow custom date component callbacks to be provided to the grid */
export function useGridDate(callbacks: CustomDateCallbacks): void {
  return useGridCustomComponent(callbacks);
}

/** Hook to allow custom filter component callbacks to be provided to the grid */
export function useGridFilter(callbacks: CustomFilterCallbacks): void {
  return useGridCustomComponent(callbacks);
}

/** Hook to allow custom filter component callbacks to be provided to the grid when using `enableFilterHandlers = true` */
export function useGridFilterDisplay(callbacks: CustomFilterDisplayCallbacks): void {
  return useGridCustomComponent(callbacks);
}

/** Hook to allow custom floating filter component callbacks to be provided to the grid */
export function useGridFloatingFilter(callbacks: CustomFloatingFilterCallbacks): void {
  useGridCustomComponent(callbacks);
}

/** Hook to allow custom menu item component callbacks to be provided to the grid */
export function useGridMenuItem(callbacks: CustomMenuItemCallbacks): void {
  useGridCustomComponent(callbacks);
}
