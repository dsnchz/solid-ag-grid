import type { IDragAndDropImageComponent, IDragAndDropImageParams } from "ag-grid-community";

import { CustomComponentWrapper } from "./customComponentWrapper";
import type { CustomDragAndDropImageProps } from "./interfaces";

export class DragAndDropImageComponentWrapper
  extends CustomComponentWrapper<IDragAndDropImageParams, CustomDragAndDropImageProps, object>
  implements IDragAndDropImageComponent
{
  private label: string = "";
  private icon: string | null = null;
  private shake: boolean = false;

  public setIcon(iconName: string, shake: boolean): void {
    this.icon = iconName;
    this.shake = shake;

    this.refreshProps();
  }

  public setLabel(label: string): void {
    this.label = label;
    this.refreshProps();
  }

  protected override getProps(): CustomDragAndDropImageProps {
    const { label, icon, shake } = this;
    return {
      ...super.getProps(),
      label,
      icon,
      shake,
    };
  }
}
