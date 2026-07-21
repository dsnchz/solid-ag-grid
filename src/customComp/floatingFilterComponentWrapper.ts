import type { IFloatingFilter, IFloatingFilterParams } from "ag-grid-community";

import { CustomComponentWrapper } from "./customComponentWrapper";
import { updateFloatingFilterParent } from "./floatingFilterComponentProxy";
import type { CustomFloatingFilterCallbacks, CustomFloatingFilterProps } from "./interfaces";

// floating filter is normally instantiated via the Solid header filter cell comp, but not in the case of multi filter
export class FloatingFilterComponentWrapper
  extends CustomComponentWrapper<
    IFloatingFilterParams,
    CustomFloatingFilterProps,
    CustomFloatingFilterCallbacks
  >
  implements IFloatingFilter
{
  private model: any = null;
  private readonly onModelChange = (model: any) => this.updateModel(model);

  public onParentModelChanged(parentModel: any): void {
    this.model = parentModel;
    this.refreshProps();
  }

  public refresh(newParams: IFloatingFilterParams): void {
    this.sourceParams = newParams;
    this.refreshProps();
  }

  protected override getOptionalMethods(): string[] {
    return ["afterGuiAttached"];
  }

  private updateModel(model: any): void {
    this.model = model;
    this.refreshProps();
    // don't need to wait on `refreshProps` as not reliant on state maintained inside Solid
    updateFloatingFilterParent(this.sourceParams, model);
  }

  protected override getProps(): CustomFloatingFilterProps {
    return {
      ...super.getProps(),
      model: this.model,
      onModelChange: this.onModelChange,
    };
  }
}
