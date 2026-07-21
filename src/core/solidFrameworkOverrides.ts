import { VanillaFrameworkOverrides } from "ag-grid-community";
import type { FrameworkOverridesIncomingSource } from "ag-stack";

// import cycle (overrides → detailCellRenderer → agGridSolid → overrides) is benign: the
// bindings are only dereferenced when the map below is built, at grid boot — long after all
// module bodies have evaluated (React inlines DetailCellRenderer to dodge this; we keep the
// separate file per ARCHITECTURE §1)
import DetailCellRenderer from "../cellRenderer/detailCellRenderer";
import GroupCellRenderer from "../cellRenderer/groupCellRenderer";
import { runWithoutFlush } from "./utils";

export class SolidFrameworkOverrides extends VanillaFrameworkOverrides {
  private queueUpdates = false;
  // RENDERING-ENGINE CAST VERDICT (T3.11): 'solid' is not in the core's declared union
  // ('vanilla' | 'react'), so both the field and the constructor arg carry casts. Audited
  // ag-grid-community 36.0.1: `renderingEngine` has ZERO runtime readers (its only occurrence
  // is the base-class assignment); its known external consumer is AG Charts integration, whose
  // `=== 'react'` check correctly evaluates false for 'solid' and falls back to non-React chart
  // rendering. The constructor's frameworkName feeds exactly two things — `baseDocLink =
  // ${BASE_URL}/${frameworkName}-data-grid` (getDocLink + setValidationDocLink), so every core
  // warning/error links to /solid-data-grid/ (desirable), and nothing else. Verdict: cast is
  // safe; keep the truthful 'solid' tag.
  public override readonly renderingEngine = "solid" as unknown as "react";

  constructor(
    private readonly processQueuedUpdates: () => void,
    public override readonly usesAgGridProvider: boolean,
  ) {
    super("solid" as unknown as "react");
  }

  private readonly frameworkComponents: { [name: string]: any } = {
    agGroupCellRenderer: GroupCellRenderer,
    agGroupRowRenderer: GroupCellRenderer,
    agDetailCellRenderer: DetailCellRenderer,
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

  override wrapIncoming: <T>(callback: () => T, source?: FrameworkOverridesIncomingSource) => T = (
    callback,
    source,
  ) => {
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
