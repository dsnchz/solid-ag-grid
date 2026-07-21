import { AgPromise } from "ag-grid-community";

import type { UserSolidComponent } from "../core/solidComponent";
import { SolidComponent } from "../core/solidComponent";
import CustomWrapperComp from "./customWrapperComp";

// React's WrapperParams constrain P to { key?: string } and strip the key in the shell —
// Solid has no key concept, so the constraint (and the stripping) is dropped.
export type WrapperParams<P, M> = {
  initialProps: P;
  CustomComponentClass: UserSolidComponent;
  setMethods: (methods: M) => void;
  addUpdateCallback: (callback: (props: P) => void) => void;
};

export function addOptionalMethods<M, C>(
  optionalMethodNames: string[],
  providedMethods: M,
  component: C,
): void {
  for (const methodName of optionalMethodNames) {
    const providedMethod = (providedMethods as any)[methodName];
    if (providedMethod) {
      (component as any)[methodName] = providedMethod;
    }
  }
}

/**
 * Port of React's `CustomComponentWrapper`: base class of the T3.7 reactive custom-component
 * wrappers. Renders `CustomWrapperComp` around the user component and keeps an updateCallback
 * so the TS side can push new props into the live component instead of remounting it.
 */
export class CustomComponentWrapper<TInputParams, TOutputParams, TMethods> extends SolidComponent {
  private updateCallback?: () => AgPromise<void>;
  private resolveUpdateCallback!: () => void;
  private readonly awaitUpdateCallback = new AgPromise<void>((resolve) => {
    this.resolveUpdateCallback = resolve;
  });

  protected providedMethods!: TMethods;

  // cast: the WrapperParams prop shape is erased at the portal boundary (UserSolidComponent
  // is Record<string, any> by construction)
  protected wrapperComponent: UserSolidComponent = CustomWrapperComp as UserSolidComponent;

  protected sourceParams!: TInputParams;

  public override init(params: TInputParams): AgPromise<void> {
    this.sourceParams = params;
    return super.init(this.getProps());
  }

  public override addMethod(): void {
    // do nothing
  }

  public getInstance(): AgPromise<any> {
    return this.instanceCreated.then(() => this.componentInstance);
  }

  public override getFrameworkComponentInstance(): any {
    return this;
  }

  protected override getPortalComponent(): UserSolidComponent {
    return this.wrapperComponent;
  }

  protected override getPortalProps(props: any): Record<string, any> {
    const wrapperParams: WrapperParams<TOutputParams, TMethods> = {
      initialProps: props,
      CustomComponentClass: this.solidComponent,
      setMethods: (methods: TMethods) => this.setMethods(methods),
      addUpdateCallback: (callback: (props: TOutputParams) => void) => {
        // this hooks up `CustomWrapperComp` to allow props updates to be pushed to the custom component
        this.updateCallback = () => {
          callback(this.getProps());
          return new AgPromise<void>((resolve) => {
            // ensure prop updates have happened (the shell's signal write applies on the
            // microtask batch — a macrotask is comfortably past it, matching React)
            setTimeout(() => {
              resolve();
            });
          });
        };
        this.resolveUpdateCallback();
      },
    };
    return wrapperParams as Record<string, any>;
  }

  protected setMethods(methods: TMethods): void {
    this.providedMethods = methods;
    addOptionalMethods(this.getOptionalMethods(), this.providedMethods, this);
  }

  protected getOptionalMethods(): string[] {
    return [];
  }

  protected getProps(): TOutputParams {
    return {
      ...this.sourceParams,
      ref: this.ref,
    } as any;
  }

  protected refreshProps(): AgPromise<void> {
    if (this.updateCallback) {
      return this.updateCallback();
    }
    // `refreshProps` is assigned in an effect. It's possible it hasn't been run before the first usage, so wait.
    return new AgPromise<void>((resolve) =>
      this.awaitUpdateCallback.then(() => {
        this.updateCallback!().then(() => resolve());
      }),
    );
  }
}
