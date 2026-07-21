import type {
  IAfterGuiAttachedParams,
  IDoesFilterPassParams,
  IFilter,
  IFilterParams,
} from "ag-grid-community";
import { AgPromise } from "ag-grid-community";

import { CustomComponentWrapper } from "./customComponentWrapper";
import type { CustomFilterCallbacks, CustomFilterProps } from "./interfaces";

export class FilterComponentWrapper
  extends CustomComponentWrapper<IFilterParams, CustomFilterProps, CustomFilterCallbacks>
  implements IFilter
{
  private model: any = null;
  private readonly onModelChange = (model: any) => this.updateModel(model);
  private readonly onUiChange = () => this.sourceParams.filterModifiedCallback();
  private expectingNewMethods = true;
  private hasBeenActive = false;
  // this is used for the initial component setup
  private resolveSetMethodsCallback!: () => void;
  private readonly awaitSetMethodsCallback = new AgPromise<void>((resolve) => {
    this.resolveSetMethodsCallback = resolve;
  });

  public isFilterActive(): boolean {
    return this.model != null;
  }

  public doesFilterPass(params: IDoesFilterPassParams<any>): boolean {
    return this.providedMethods.doesFilterPass(params);
  }

  public getModel(): any {
    return this.model;
  }

  public setModel(model: any): AgPromise<void> {
    this.expectingNewMethods = true;
    this.model = model;
    this.hasBeenActive ||= this.isFilterActive();
    return this.refreshProps();
  }

  public refresh(newParams: IFilterParams): boolean {
    this.sourceParams = newParams;
    this.refreshProps();
    return true;
  }

  public afterGuiAttached(params?: IAfterGuiAttachedParams): void {
    const providedMethods = this.providedMethods;
    if (!providedMethods) {
      // setMethods hasn't been called yet
      this.awaitSetMethodsCallback.then(() => this.providedMethods?.afterGuiAttached?.(params));
    } else {
      providedMethods.afterGuiAttached?.(params);
    }
  }

  protected override getOptionalMethods(): string[] {
    return ["afterGuiDetached", "onNewRowsLoaded", "getModelAsString", "onAnyFilterChanged"];
  }

  protected override setMethods(methods: CustomFilterCallbacks): void {
    // filtering is run after the component's `doesFilterPass` receives the new `model`.
    // However, if `doesFilterPass` is using a state variable derived from `model` (via effect),
    // it won't have updated in time when filtering runs.
    // We catch this use case here, and re-run filtering.
    // If the filter has never been active, we don't need to do this
    if (
      this.expectingNewMethods === false &&
      this.hasBeenActive &&
      this.providedMethods?.doesFilterPass !== methods?.doesFilterPass
    ) {
      setTimeout(() => {
        this.sourceParams.filterChangedCallback();
      });
    }
    this.expectingNewMethods = false;
    super.setMethods(methods);
    this.resolveSetMethodsCallback();
  }

  private updateModel(model: any): void {
    // Divergence from React: React gates `filterChangedCallback` on the NEXT `setMethods`
    // call, which its re-render guarantees (useGridFilter re-runs with a `doesFilterPass`
    // closing over the new model). Solid components run once — no re-registration ever
    // arrives, so that gate would deadlock. The single registered `doesFilterPass` reads the
    // pushed props signal instead, which has applied by the time `refreshProps` resolves
    // (macrotask after the microtask flush) — safe to trigger filtering then. Users who DO
    // re-register from an effect are covered by the changed-doesFilterPass re-run in
    // `setMethods` above.
    this.setModel(model).then(() => {
      this.sourceParams.filterChangedCallback();
    });
  }

  protected override getProps(): CustomFilterProps {
    const props = super.getProps();
    // remove props in IFilterParams but not CustomFilterProps
    delete (props as any).filterChangedCallback;
    return {
      ...props,
      model: this.model,
      onModelChange: this.onModelChange,
      onUiChange: this.onUiChange,
    };
  }
}
