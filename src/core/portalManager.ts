import type { Accessor, Setter } from "solid-js";
import { createSignal } from "solid-js";

export interface PortalInfo {
  mount: HTMLElement;
  SolidClass: any;
  props: any;
  ref?: (instance: any) => void;
}

const MAX_COMPONENT_CREATION_TIME_IN_MS: number = 1000; // a second should be more than enough to instantiate a component

export class PortalManager {
  private readonly wrappingElement: string;
  private destroyed = false;

  private readonly portals: Accessor<PortalInfo[]>;
  private readonly setPortals: Setter<PortalInfo[]>;

  private readonly maxComponentCreationTimeMs: number;

  constructor(wrappingElement?: string, maxComponentCreationTimeMs?: number) {
    this.wrappingElement = wrappingElement ? wrappingElement : "div";
    this.maxComponentCreationTimeMs = maxComponentCreationTimeMs
      ? maxComponentCreationTimeMs
      : MAX_COMPONENT_CREATION_TIME_IN_MS;

    const [portals, setPortals] = createSignal<PortalInfo[]>([]);
    this.portals = portals;
    this.setPortals = setPortals;
  }

  public getPortals(): PortalInfo[] {
    return this.portals();
  }

  public destroy(): void {
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public getComponentWrappingElement(): string {
    return this.wrappingElement;
  }

  public getMaxComponentCreationTimeMs(): number {
    return this.maxComponentCreationTimeMs;
  }

  // full semantics (waitForInstance polling, flush() last resort) land in T3.6
  public addPortal(info: PortalInfo): void {
    this.setPortals((prev) => [...prev, info]);
  }

  public removePortal(info: PortalInfo): void {
    this.setPortals((prev) => prev.filter((curPortal) => curPortal !== info));
  }
}
