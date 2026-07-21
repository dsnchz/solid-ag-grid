import type { ComponentType, IComponent, WrappableInterface } from "ag-grid-community";
import { AgPromise } from "ag-grid-community";
import type { Component } from "solid-js";
import { createSignal } from "solid-js";

import generateNewKey from "./keyGenerator";
import type { PortalInfo, PortalManager } from "./portalManager";

/**
 * User components reach the wrapper with their prop shapes runtime-erased (cell renderers,
 * filters, tool panels all flow through the same factory), so props are Record<string, any>
 * by construction — the `any` is quarantined here.
 */
export type UserSolidComponent = Component<Record<string, any>>;

/**
 * Port of React's `ReactComponent` (shared/reactComponent.ts): the bridge the grid core talks
 * to when a user registered a Solid component for a JS-side slot (filters, overlays, tooltips,
 * cell renderers used inside JS comps, ...). Renders the user component through a portal entry
 * (see portalManager.ts) into a wrapping element the core places in its DOM.
 *
 * Stateless-vs-ref distinction: React detects statelessness upfront (isComponentStateless).
 * All Solid components are functions, so statelessness is unknowable until render: a component
 * that calls `props.ref(handle)` has an imperative instance; one that never does is the
 * "stateless" analog. `rendered()` therefore checks instance OR mounted DOM, and
 * `instanceCreated` resolves true on the ref call or false once the comp rendered without one.
 */
export class SolidComponent implements IComponent<any>, WrappableInterface {
  protected eParentElement!: HTMLElement;
  protected componentInstance: any;
  protected solidComponent: UserSolidComponent;
  protected portalManager: PortalManager;
  protected portalInfo: PortalInfo | null = null;
  protected componentType: ComponentType;

  protected key: string;
  protected ref?: (element: any) => void;
  protected instanceCreated: AgPromise<boolean>;
  private resolveInstanceCreated?: (value: boolean) => void;
  private readonly suppressFallbackMethods: boolean;

  constructor(
    solidComponent: UserSolidComponent,
    portalManager: PortalManager,
    componentType: ComponentType,
    suppressFallbackMethods?: boolean,
  ) {
    this.solidComponent = solidComponent;
    this.portalManager = portalManager;
    this.componentType = componentType;
    this.suppressFallbackMethods = !!suppressFallbackMethods;

    this.key = generateNewKey();

    this.instanceCreated = new AgPromise<boolean>((resolve) => {
      this.resolveInstanceCreated = resolve;
    });
  }

  public getGui(): HTMLElement {
    return this.eParentElement;
  }

  /** `getGui()` returns the parent element. This returns the actual root element. */
  public getRootElement(): HTMLElement {
    // firstElementChild, not firstChild: Solid's <Portal> brackets its content with marker
    // text nodes inside the mount element
    return this.eParentElement.firstElementChild as HTMLElement;
  }

  public destroy(): void {
    if (this.componentInstance && typeof this.componentInstance.destroy == "function") {
      this.componentInstance.destroy();
    }
    const portalInfo = this.portalInfo;
    if (portalInfo) {
      this.portalManager.destroyPortal(portalInfo);
    }
  }

  protected createParentElement(_params: any): HTMLElement {
    const componentWrappingElement = this.portalManager.getComponentWrappingElement();
    const eParentElement = document.createElement(componentWrappingElement || "div");

    eParentElement.classList.add("ag-solid-container");

    return eParentElement;
  }

  public statelessComponentRendered(): boolean {
    // childNodes (not just childElementCount) also covers text-only renderers; the Portal
    // marker nodes only appear after the portal content applied, i.e. after the component
    // body — and any props.ref call in it — already ran, so this never wins a race against
    // the instance check in rendered()
    return this.eParentElement.childElementCount > 0 || this.eParentElement.childNodes.length > 0;
  }

  public getFrameworkComponentInstance(): any {
    return this.componentInstance;
  }

  public getSolidComponentName(): string {
    return this.solidComponent.name;
  }

  public hasMethod(name: string): boolean {
    const frameworkComponentInstance = this.getFrameworkComponentInstance();
    return (
      (!!frameworkComponentInstance && frameworkComponentInstance[name] != null) ||
      this.fallbackMethodAvailable(name)
    );
  }

  public callMethod(name: string, args: IArguments): void {
    const frameworkComponentInstance = this.getFrameworkComponentInstance();

    if (!frameworkComponentInstance) {
      if (this.resolveInstanceCreated == null || this.portalManager.isDestroyed()) {
        // instanceCreated settled without a handle (the stateless analog) or the grid is
        // gone — no instance will ever arrive, go straight to the fallback
        return this.fallbackMethod(name, !!args && args[0] ? args[0] : {});
      }
      // instance not ready yet - wait for it
      setTimeout(() => this.callMethod(name, args));
      return;
    }

    const method = frameworkComponentInstance[name];

    if (method) {
      return method.apply(frameworkComponentInstance, args);
    }

    if (this.fallbackMethodAvailable(name)) {
      return this.fallbackMethod(name, !!args && args[0] ? args[0] : {});
    }
  }

  public addMethod(name: string, callback: (...args: any[]) => any): void {
    (this as any)[name] = callback;
  }

  public init(params: any): AgPromise<void> {
    this.eParentElement = this.createParentElement(params);

    this.createPortalInfo(params);

    return new AgPromise<void>((resolve) => this.createSolidComponent(resolve));
  }

  private createPortalInfo(params: any): void {
    // grab hold of the actual instance if the component registers one via props.ref(handle)
    this.ref = (element: any) => {
      this.componentInstance = element;
      if (element != null) {
        this.resolveInstanceCreated?.(true);
        this.resolveInstanceCreated = undefined;
      }
    };
    const [props, setProps] = createSignal<Record<string, any>>(
      this.createOrUpdatePortalProps(params),
    );
    this.portalInfo = {
      key: this.key,
      mount: this.eParentElement,
      SolidClass: this.getPortalComponent(),
      props,
      // wrap so a params object is never mistaken for a setter updater function
      setProps: (nextProps) => setProps(() => nextProps),
      ref: this.ref,
    };
  }

  /**
   * Parity with React's createOrUpdatePortal: patch the ref into the params object so it
   * reaches the component through the props spread (CustomComponentWrapper relies on
   * `initialProps.ref` being live by the time getProps() output is rendered).
   */
  private createOrUpdatePortalProps(params: any): Record<string, any> {
    params.ref = this.ref;
    return this.getPortalProps(params);
  }

  /** overridden by CustomComponentWrapper to render the CustomWrapperComp shell instead */
  protected getPortalComponent(): UserSolidComponent {
    return this.solidComponent;
  }

  /** overridden by CustomComponentWrapper to wrap params into WrapperParams */
  protected getPortalProps(params: any): Record<string, any> {
    return params;
  }

  private createSolidComponent(resolve: (value: any) => void): void {
    this.portalManager.mountPortal(this.portalInfo!, this, (value) => {
      // the component rendered without ever calling props.ref → settle instanceCreated as
      // false, the equivalent of React's upfront stateless detection
      if (this.resolveInstanceCreated) {
        this.resolveInstanceCreated(false);
        this.resolveInstanceCreated = undefined;
      }
      resolve(value);
    });
  }

  public rendered(): boolean {
    return !!this.componentInstance || this.statelessComponentRendered();
  }

  /*
   * fallback methods - these will be invoked if a corresponding instance method is not present
   * for example if refresh is called and is not available on the component instance, then refreshComponent on this
   * class will be invoked instead
   *
   * Currently only refresh is supported
   */
  protected refreshComponent(args: any): void {
    // identity-preserving prop push (portal identity verdict in portalManager.ts): the portal
    // entry stays; the new props flow to the live component through the dynamic spread
    this.portalInfo?.setProps(this.createOrUpdatePortalProps(args));
  }

  protected fallbackMethod(name: string, params: any): any {
    const method = (this as any)[`${name}Component`];
    if (!this.suppressFallbackMethods && !!method) {
      return method.bind(this)(params);
    }
  }

  protected fallbackMethodAvailable(name: string): boolean {
    if (this.suppressFallbackMethods) {
      return false;
    }
    const method = (this as any)[`${name}Component`];
    return !!method;
  }
}
