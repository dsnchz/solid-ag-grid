import type {
  ComponentType,
  FrameworkComponentWrapper,
  GridOptions,
  WrappableInterface,
} from "ag-grid-community";
import { _getGridOption, BaseComponentWrapper } from "ag-grid-community";

import { CellRendererComponentWrapper } from "../customComp/cellRendererComponentWrapper";
import { ColumnSelectionLabelRendererComponentWrapper } from "../customComp/columnSelectionLabelRendererComponentWrapper";
import { CustomOverlayComponentWrapper } from "../customComp/customOverlayComponentWrapper";
import { DateComponentWrapper } from "../customComp/dateComponentWrapper";
import { DragAndDropImageComponentWrapper } from "../customComp/dragAndDropImageComponentWrapper";
import { FilterComponentWrapper } from "../customComp/filterComponentWrapper";
import { FilterDisplayComponentWrapper } from "../customComp/filterDisplayComponentWrapper";
import { FloatingFilterComponentWrapper } from "../customComp/floatingFilterComponentWrapper";
import { FloatingFilterDisplayComponentWrapper } from "../customComp/floatingFilterDisplayComponentWrapper";
import { InnerHeaderComponentWrapper } from "../customComp/innerHeaderComponentWrapper";
import { MenuItemComponentWrapper } from "../customComp/menuItemComponentWrapper";
import { StatusPanelComponentWrapper } from "../customComp/statusPanelComponentWrapper";
import { ToolPanelComponentWrapper } from "../customComp/toolPanelComponentWrapper";
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
      const getComponentClass = (
        propertyName: string,
      ): (new (...args: any[]) => WrappableInterface) | undefined => {
        switch (propertyName) {
          case "filter":
            return _getGridOption(gridOptions, "enableFilterHandlers")
              ? FilterDisplayComponentWrapper
              : FilterComponentWrapper;
          case "floatingFilterComponent":
            return _getGridOption(gridOptions, "enableFilterHandlers")
              ? FloatingFilterDisplayComponentWrapper
              : FloatingFilterComponentWrapper;
          case "dateComponent":
            return DateComponentWrapper;
          case "dragAndDropImageComponent":
            return DragAndDropImageComponentWrapper;
          case "loadingOverlayComponent":
          case "noRowsOverlayComponent":
          case "overlayComponent":
          case "activeOverlay":
            return CustomOverlayComponentWrapper;
          case "statusPanel":
            return StatusPanelComponentWrapper;
          case "toolPanel":
            return ToolPanelComponentWrapper;
          case "menuItem":
            return MenuItemComponentWrapper;
          case "cellRenderer":
            return CellRendererComponentWrapper;
          case "columnLabelRenderer":
            return ColumnSelectionLabelRendererComponentWrapper;
          case "innerHeaderComponent":
            return InnerHeaderComponentWrapper;
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
        case "overlayComponent":
        case "activeOverlay":
        case "statusPanel":
        case "toolPanel":
        case "menuItem":
        case "cellRenderer":
        case "columnLabelRenderer":
          // Grid ID is always set at this point (UserComponentFactory calls setGridId on wire)
          warnReactiveCustomComponents(this.gridId!);
          break;
      }
    }
    // only renderers supporting JavaScript functions and tool panels should use fallback methods
    const suppressFallbackMethods =
      !componentType.supportsJsFunction && componentType.name !== "toolPanel";
    return new SolidComponent(userComponent, this.parent, componentType, suppressFallbackMethods);
  }
}
