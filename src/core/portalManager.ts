import type { Accessor } from "solid-js";
import { createSignal, flush } from "solid-js";

import type { SolidComponent, UserSolidComponent } from "./solidComponent";

// PORTAL IDENTITY VERDICT (ARCHITECTURE.md Open question 8, resolved T3.6):
// identity-preserving portal entries with a per-portal props SIGNAL — no updatePortal(old, new).
// - The <For> in the entry (GridPortals) keys portal entries by PortalInfo object identity. An
//   entry is created once per SolidComponent.init and never replaced; the fallback
//   refreshComponent pushes new props through info.setProps, so the <Portal> — and the user
//   component instance under it — is never torn down. DOM identity is preserved across refresh
//   (unit test "fallback refresh ... element identity preserved").
// - React's updateReactPortal(oldPortal, newPortal) is deliberately NOT ported: replacing the
//   entry would remount the component under <For>'s identity keying. setProps IS our
//   updatePortal.
// - Why a signal-of-object and not the per-portal STORE the plan suggested: Solid 2.0 stores
//   wrap ANY non-frozen non-Node object on read (isWrappable, @solidjs/signals dist/dev.js —
//   unlike 1.x, class instances are wrappable). Grid params carry api/node/column class
//   instances; a store would hand user components deep proxies of them, breaking identity
//   comparisons (props.node === node) and turning the grid core's internal mutations into
//   write-outside-setter hazards. A signal holding the RAW params object keeps every value
//   untouched, and the dynamic JSX spread `{...info.props()}` re-reads the signal per property
//   access, so a setProps replacement reaches the live component without remount — the same
//   semantics React gets from re-rendering with new props.
// - React's refresher/batchUpdate machinery is not needed: the portals signal IS the refresher,
//   and Solid 2.0 batches signal writes to the microtask natively.

/** A user-component portal entry rendered by GridPortals inside the grid entry component. */
export interface PortalInfo {
  /** parity with React's portalKey — informational only; <For> keys by object identity */
  key: string;
  /** the SolidComponent's wrapping element (div.ag-solid-container) the portal renders into */
  mount: HTMLElement;
  SolidClass: UserSolidComponent;
  /** current props object (raw grid params — see the props-signal verdict above) */
  props: Accessor<Record<string, any>>;
  /** identity-preserving prop push: replaces the props object without remounting the comp */
  setProps: (nextProps: Record<string, any>) => void;
  /**
   * instance-capture callback, passed as a STATIC ref attribute after the props spread (the
   * later merge source wins) so a user comp reading `props.ref` in its body does not touch
   * the props signal — an untracked signal-backed read would trip STRICT_READ_UNTRACKED (§7.1)
   */
  ref: (instance: any) => void;
}

const MAX_COMPONENT_CREATION_TIME_IN_MS: number = 1000; // a second should be more than enough to instantiate a component

export class PortalManager {
  private readonly wrappingElement: string;
  private destroyed = false;

  private readonly portals: Accessor<PortalInfo[]>;
  private readonly setPortals: (update: (prev: PortalInfo[]) => PortalInfo[]) => void;

  private readonly maxComponentCreationTimeMs: number;

  constructor(wrappingElement?: string, maxComponentCreationTimeMs?: number) {
    this.wrappingElement = wrappingElement ? wrappingElement : "div";
    this.maxComponentCreationTimeMs = maxComponentCreationTimeMs
      ? maxComponentCreationTimeMs
      : MAX_COMPONENT_CREATION_TIME_IN_MS;

    // ownedWrite (§7.3a disposal law): destroyPortal runs from grid-core teardown, which the
    // entry triggers from onCleanup (ctx.destroy() → destroy beans → SolidComponent.destroy)
    // — a disposal-scope write without the opt-in throws REACTIVE_WRITE_IN_OWNED_SCOPE in dev.
    const [portals, setPortals] = createSignal<PortalInfo[]>([], { ownedWrite: true });
    this.portals = portals;
    this.setPortals = setPortals;
  }

  /** reactive read — the entry's <For each={...getPortals()}> tracks it */
  public getPortals(): PortalInfo[] {
    return this.portals();
  }

  public destroy(): void {
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public destroyPortal(info: PortalInfo): void {
    this.setPortals((prev) => prev.filter((curPortal) => curPortal !== info));
  }

  public getComponentWrappingElement(): string {
    return this.wrappingElement;
  }

  public mountPortal(
    info: PortalInfo,
    solidComponent: SolidComponent,
    resolve: (value: any) => void,
  ): void {
    this.setPortals((prev) => [...prev, info]);
    this.waitForInstance(solidComponent, resolve);
  }

  public waitForInstance(
    solidComponent: SolidComponent,
    resolve: (value: any) => void,
    startTime = Date.now(),
  ): void {
    // if the grid has been destroyed in the meantime just resolve
    if (this.destroyed) {
      resolve(null);
      return;
    }

    if (solidComponent.rendered()) {
      resolve(solidComponent);
      return;
    }

    if (Date.now() - startTime >= this.maxComponentCreationTimeMs) {
      // Hit the time limit — force the pending microtask batch (including the portal signal
      // write) to apply synchronously as a final attempt (flush() as flushSync stand-in, §7.2).
      // waitForInstance only reaches this branch from a macrotask timer, never mid-apply, so
      // the runWithoutFlush latch is not consulted.
      flush();
      if (solidComponent.rendered()) {
        resolve(solidComponent);
      }
      // parity with React: past the deadline and still not rendered → give up silently (the
      // init promise stays pending; a destroyed grid resolves null via the check above)
      return;
    }

    window.setTimeout(() => {
      this.waitForInstance(solidComponent, resolve, startTime);
    });
  }
}
