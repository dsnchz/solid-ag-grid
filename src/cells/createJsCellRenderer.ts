import type { Context, ICellRendererComp } from "ag-grid-community";
import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";

import type { RenderDetails } from "./interfaces";

export interface JsCellRendererOptions {
  context: Context;
  renderDetails: Accessor<RenderDetails | undefined>;
  /** true while an inline (non-popup) editor is active — the renderer is torn down (T3.8) */
  suppress?: Accessor<boolean>;
}

export interface JsCellRenderer {
  /** getGui() element of the live JS renderer — insert as derived JSX where the value goes */
  gui: Accessor<HTMLElement | undefined>;
  /** live instance, for ICellComp.getCellRenderer */
  instance: () => ICellRendererComp | undefined;
}

/**
 * Manages the lifecycle of a JS (non-framework) cell renderer. Port of React's
 * `useJsCellRenderer` (reactUi/cells/showJsRenderer.tsx) with one structural change per
 * ARCHITECTURE.md §5.1 (derived JSX insertion beats effect-appendChild): instead of appending
 * `getGui()` to `eCellValue`/`eGui` imperatively, the element is exposed as the `gui` accessor
 * and CellComp inserts it as derived JSX in the value slot. That slot already lives inside the
 * cell-value span when the wrapper/tools are shown and directly in the cell otherwise, so
 * React's tools-parent selection (`showTools ? eCellValue : eGui`) and its
 * `waitingForToolsSetup` / `cellValueVersion` re-run plumbing collapse into JSX placement —
 * and unlike React, the element migrates to the right parent when the wrapper toggles.
 * The effect owns only the instance lifecycle (create / refresh-else-recreate / destroy).
 */
export const createJsCellRenderer = (options: JsCellRendererOptions): JsCellRenderer => {
  const { context, renderDetails, suppress } = options;

  let comp: ICellRendererComp | undefined;
  // bumped on every create/destroy so a stale async newAgStackInstance resolution is discarded
  // (§7 async caution: once-only work needs an idempotence guard)
  let compVersion = 0;
  // internal bridge signal: destroyCellRenderer runs from onCleanup (disposal is an owned
  // scope, where writes throw REACTIVE_WRITE_IN_OWNED_SCOPE in dev) — opt in narrowly
  const [gui, setGui] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true });

  const destroyCellRenderer = () => {
    compVersion++;
    if (!comp) {
      return;
    }
    // Solid removes the element when the gui signal clears; the direct remove also covers a
    // gui that was never inserted (comp destroyed before the JSX slot mounted)
    comp.getGui()?.remove();
    context.destroyBean(comp);
    comp = undefined;
    setGui(undefined);
  };

  // create or refresh the JS cell renderer.
  // Effect classification (§5.1 bridge category 2): signal-keyed lifecycle of a non-Solid
  // instance — creation/refresh/destruction of the JS renderer bean, keyed on renderDetails
  // and the inline-edit suppression flag.
  createEffect(
    () => ({ details: renderDetails(), suppressed: suppress?.() ?? false }),
    ({ details, suppressed }) => {
      const jsCompDetails =
        details?.compDetails != null && !details.compDetails.componentFromFramework;
      const showComp = jsCompDetails && !suppressed;

      // if not showing the comp, destroy any existing one and return
      if (!showComp) {
        destroyCellRenderer();
        return;
      }

      const compDetails = details!.compDetails!;

      if (comp) {
        // attempt refresh if a refresh method exists and a new instance was not forced
        const attemptRefresh = comp.refresh != null && details!.force == false;
        const refreshResult = attemptRefresh ? comp.refresh!(compDetails.params) : false;
        const refreshWorked = refreshResult === true || refreshResult === undefined;

        // if refresh worked, nothing else to do
        if (refreshWorked) {
          return;
        }

        // if refresh didn't work, destroy and fall through so a new renderer is created below
        destroyCellRenderer();
      }

      const version = ++compVersion;
      compDetails.newAgStackInstance().then((newComp: ICellRendererComp) => {
        if (!newComp) {
          return;
        }
        if (version !== compVersion || context.isDestroyed()) {
          context.destroyBean(newComp);
          return;
        }
        comp = newComp;
        setGui(newComp.getGui() ?? undefined);
      });
      // We do NOT return a destroy cleanup from this apply — the instance must survive
      // re-applies so the refresh-else-recreate path above can run against it (same subtlety
      // as React's "do not return the destroy here").
    },
  );

  // final disposal only — the update effect above deliberately keeps the comp alive
  onCleanup(destroyCellRenderer);

  return { gui, instance: () => comp };
};
