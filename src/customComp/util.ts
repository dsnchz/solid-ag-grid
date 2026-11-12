import type {
  FilterDisplay,
  ICellEditor,
  IFilter,
  IStatusPanel,
  IToolPanel,
} from "ag-grid-community";
import { _warnForGrid, AgPromise } from "ag-grid-community";

/**
 * Function to retrieve the Solid component from an instance returned by the grid.
 * @param wrapperComponent Instance component from the grid
 * @param callback Callback which is provided the underlying Solid custom component
 */
export function getInstance<
  TGridComponent extends IFilter | FilterDisplay | IToolPanel | ICellEditor | IStatusPanel =
    | IFilter
    | FilterDisplay
    | IToolPanel
    | ICellEditor
    | IStatusPanel,
  TCustomComponent extends TGridComponent = TGridComponent,
>(
  wrapperComponent: TGridComponent,
  callback: (customComponent: TCustomComponent | undefined) => void,
): void {
  const promise = (wrapperComponent as any)?.getInstance?.() ?? AgPromise.resolve(undefined);
  promise.then((comp: TCustomComponent | undefined) => callback(comp));
}

/**
 * Logs the grid's warning that a custom Solid component needs `reactiveCustomComponents`
 * enabled (AG Grid warning #231), attributed to the grid `gridId`. Exported for parity with
 * ag-grid-react.
 */
export function warnReactiveCustomComponents(gridId: string): void {
  _warnForGrid(gridId, 231);
}
