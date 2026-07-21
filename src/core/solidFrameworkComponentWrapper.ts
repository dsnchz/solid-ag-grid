import type {
  ComponentType,
  FrameworkComponentWrapper,
  GridOptions,
  WrappableInterface,
} from "ag-grid-community";
import { BaseComponentWrapper } from "ag-grid-community";
import type { Component } from "solid-js";

import type { PortalManager } from "./portalManager";

/**
 * User components reach the wrapper with their prop shapes runtime-erased (cell renderers,
 * filters, tool panels all flow through the same factory), so props are Record<string, any>
 * by construction — the `any` is quarantined here.
 */
export type UserSolidComponent = Component<Record<string, any>>;

/**
 * Minimal stub of SolidComponent (full portal-backed version lands in T3.6). Enough for the grid
 * core to hold a wrapper reference; does not render the user component yet.
 */
export class SolidComponent implements WrappableInterface {
  constructor(
    protected readonly solidComponent: UserSolidComponent,
    protected readonly portalManager: PortalManager,
    protected readonly componentType: ComponentType,
    protected readonly suppressFallbackMethods?: boolean,
  ) {}

  public hasMethod(_name: string): boolean {
    return false;
  }

  public callMethod(_name: string, _args: IArguments): void {}

  public addMethod(name: string, callback: (...args: any[]) => any): void {
    (this as any)[name] = callback;
  }
}

export class SolidFrameworkComponentWrapper
  extends BaseComponentWrapper<WrappableInterface>
  implements FrameworkComponentWrapper
{
  constructor(
    private readonly parent: PortalManager,
    private readonly gridOptions: GridOptions,
  ) {
    super();
  }

  protected createWrapper(
    // BaseComponentWrapper declares a class constructor (vanilla comps are classes); for a
    // framework wrapper the runtime value is the user's Solid function component.
    comp: { new (): unknown },
    componentType: ComponentType,
  ): WrappableInterface {
    const userComponent = comp as unknown as UserSolidComponent;
    // T3.6/T3.7 plug the reactive custom-component wrapper classes (per componentType.name) in
    // here, keyed off _getGridOption(this.gridOptions, 'reactiveCustomComponents'); until then
    // every component type falls through to the stub SolidComponent.
    const getComponentClass = (
      propertyName: string,
    ): (new (...args: any[]) => WrappableInterface) | undefined => {
      switch (propertyName) {
        case "filter":
        case "floatingFilterComponent":
        case "dateComponent":
        case "dragAndDropImageComponent":
        case "loadingOverlayComponent":
        case "noRowsOverlayComponent":
        case "activeOverlay":
        case "statusPanel":
        case "toolPanel":
        case "menuItem":
        case "cellRenderer":
        case "innerHeaderComponent":
        default:
          return undefined;
      }
    };
    const ComponentClass = getComponentClass(componentType.name);
    if (ComponentClass) {
      return new ComponentClass(userComponent, this.parent, componentType);
    }
    // only cell renderers and tool panel should use fallback methods
    const suppressFallbackMethods =
      !componentType.cellRenderer && componentType.name !== "toolPanel";
    return new SolidComponent(userComponent, this.parent, componentType, suppressFallbackMethods);
  }
}
