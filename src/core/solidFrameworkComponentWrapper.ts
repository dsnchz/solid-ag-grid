import type {
  ComponentType,
  FrameworkComponentWrapper,
  GridOptions,
  WrappableInterface,
} from "ag-grid-community";
import { _getGridOption, BaseComponentWrapper } from "ag-grid-community";

import { warnReactiveCustomComponents } from "../customComp/util";
import type { PortalManager } from "./portalManager";
import type { UserSolidComponent } from "./solidComponent";
import { SolidComponent } from "./solidComponent";

export type { UserSolidComponent } from "./solidComponent";

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
    const gridOptions = this.gridOptions;
    const reactiveCustomComponents = _getGridOption(gridOptions, "reactiveCustomComponents");
    if (reactiveCustomComponents) {
      // T3.7 plugs the reactive wrapper classes (CustomComponentWrapper subclasses) into these
      // slots; until then every name falls through to the plain SolidComponent below.
      const getComponentClass = (
        propertyName: string,
      ): (new (...args: any[]) => WrappableInterface) | undefined => {
        switch (propertyName) {
          case "filter": // T3.7: Filter(Display)ComponentWrapper (keyed on enableFilterHandlers)
          case "floatingFilterComponent": // T3.7: FloatingFilter(Display)ComponentWrapper
          case "dateComponent": // T3.7: DateComponentWrapper
          case "dragAndDropImageComponent": // T3.7: DragAndDropImageComponentWrapper
          case "loadingOverlayComponent": // T3.7: CustomOverlayComponentWrapper
          case "noRowsOverlayComponent": // T3.7: CustomOverlayComponentWrapper
          case "activeOverlay": // T3.7: CustomOverlayComponentWrapper
          case "statusPanel": // T3.7: StatusPanelComponentWrapper
          case "toolPanel": // T3.7: ToolPanelComponentWrapper
          case "menuItem": // T3.7: MenuItemComponentWrapper
          case "cellRenderer": // T3.7: CellRendererComponentWrapper
          case "innerHeaderComponent": // T3.7: InnerHeaderComponentWrapper
          default:
            return undefined;
        }
      };
      const ComponentClass = getComponentClass(componentType.name);
      if (ComponentClass) {
        return new ComponentClass(userComponent, this.parent, componentType);
      }
    } else {
      switch (componentType.name) {
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
          warnReactiveCustomComponents();
          break;
      }
    }
    // only cell renderers and tool panel should use fallback methods
    const suppressFallbackMethods =
      !componentType.cellRenderer && componentType.name !== "toolPanel";
    return new SolidComponent(userComponent, this.parent, componentType, suppressFallbackMethods);
  }
}
