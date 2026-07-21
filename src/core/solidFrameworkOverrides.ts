import { VanillaFrameworkOverrides } from "ag-grid-community";
import type { FrameworkOverridesIncomingSource } from "ag-stack";

import { runWithoutFlush } from "./utils";

export class SolidFrameworkOverrides extends VanillaFrameworkOverrides {
  private queueUpdates = false;
  // 'solid' is not part of the core's declared union ('vanilla' | 'react'); community core never
  // reads this value at runtime, so we keep the truthful 'solid' tag under a cast.
  public override readonly renderingEngine = "solid" as unknown as "react";

  constructor(
    private readonly processQueuedUpdates: () => void,
    public override readonly usesAgGridProvider: boolean,
  ) {
    super("solid" as unknown as "react");
  }

  private readonly frameworkComponents: { [name: string]: any } = {
    // T3.10: GroupCellRenderer / DetailCellRenderer framework implementations
    agGroupCellRenderer: undefined,
    agGroupRowRenderer: undefined,
    agDetailCellRenderer: undefined,
  };

  public override frameworkComponent(name: string): any {
    return this.frameworkComponents[name];
  }

  override isFrameworkComponent(comp: any): boolean {
    if (!comp) {
      return false;
    }
    const prototype = comp.prototype;
    const isJsComp = prototype && "getGui" in prototype;
    return !isJsComp;
  }

  override wrapIncoming: <T>(
    callback: () => T,
    source?: FrameworkOverridesIncomingSource,
  ) => T = (callback, source) => {
    if (source === "ensureVisible") {
      // As ensureVisible could easily be called from grid code already running inside an effect
      // apply phase, we need to run it without flush() to avoid re-entrantly applying the pending
      // batch mid-render. This does mean there will be a flicker as the grid redraws the cells in
      // the new location but this is deemed less of an issue than the hazard.
      return runWithoutFlush(callback);
    }
    return callback();
  };

  getLockOnRefresh(): void {
    this.queueUpdates = true;
  }

  releaseLockOnRefresh(): void {
    this.queueUpdates = false;
    this.processQueuedUpdates();
  }

  shouldQueueUpdates(): boolean {
    return this.queueUpdates;
  }
}
