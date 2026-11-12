import type { Context, ICellRendererComp, UserCompDetails } from "ag-grid-community";
import type { Accessor } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";

export type JsCellRendererOptions = {
  context: Context;
  /** the cell's compDetails: undefined = no details yet, null = details without a renderer */
  compDetails: Accessor<UserCompDetails | null | undefined>;
  /** the core's forceNewCellRendererInstance flag for the current details */
  force: Accessor<boolean | undefined>;
  /** true while an inline (non-popup) editor is active — the renderer is torn down (T3.8) */
  suppress?: Accessor<boolean>;
  /** called after a live renderer is torn down while the cell lives on (never at final
   * disposal) — CellComp drops the outgoing renderer's `setTooltip` registration */
  onRendererDestroyed?: () => void;
};

export type JsCellRenderer = {
  /** getGui() element of the live JS renderer — insert as derived JSX where the value goes */
  gui: Accessor<HTMLElement | undefined>;
  /** live instance, for ICellComp.getCellRenderer */
  instance: () => ICellRendererComp | undefined;
};

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
  const {
    context,
    compDetails: compDetailsAccessor,
    force,
    suppress,
    onRendererDestroyed,
  } = options;

  let comp: ICellRendererComp | undefined;
  // bumped on every create/destroy so a stale async newAgStackInstance resolution is destroyed
  // unshown (§7 async caution: once-only work needs an idempotence guard). Covers React 36.3's
  // per-run `stale` flag: while an instance is pending `comp` is unset, so every re-apply of the
  // effect below either destroys or creates (both bump), and final disposal bumps too
  let compVersion = 0;
  // internal bridge signal: destroyCellRenderer runs from onCleanup (disposal is an owned
  // scope, where writes throw REACTIVE_WRITE_IN_OWNED_SCOPE in dev) — opt in narrowly
  const [gui, setGui] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true });

  // resetTooltip=false only for final disposal: the cell's tooltip feature dies with it (React
  // 36.3 `destroyCellRenderer(false)`, vanilla `destroyRenderer(false)` in CellComp.destroy)
  const destroyCellRenderer = (resetTooltip = true) => {
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

    if (resetTooltip) {
      onRendererDestroyed?.();
    }
  };

  // create or refresh the JS cell renderer.
  // Effect classification (§5.1 bridge category 2): signal-keyed lifecycle of a non-Solid
  // instance — creation/refresh/destruction of the JS renderer bean, keyed on the cell's
  // compDetails / force signals and the inline-edit suppression flag.
  createEffect(
    () => ({
      compDetails: compDetailsAccessor(),
      forced: force() == true,
      suppressed: suppress?.() ?? false,
    }),
    ({ compDetails, forced, suppressed }) => {
      const jsCompDetails = compDetails != null && !compDetails.componentFromFramework;
      const showComp = jsCompDetails && !suppressed;

      // if not showing the comp, destroy any existing one and return. A Solid renderer taking
      // over has already mounted (its <Show> branch renders before this effect applies) and may
      // have registered its own tooltip; CellComp reset the outgoing registration when it wrote
      // the new compDetails, so this teardown must not reset again and clear the successor's
      if (!showComp) {
        destroyCellRenderer(compDetails?.componentFromFramework !== true);
        return;
      }

      if (comp) {
        // attempt refresh if a refresh method exists and a new instance was not forced
        const attemptRefresh = comp.refresh != null && !forced;
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
        // a newer request or the unmount came first, so this renderer has no cell to go in
        if (version !== compVersion || context.isDestroyed()) {
          context.destroyBean(newComp);
          return;
        }
        comp = newComp;
        setGui(newComp.getGui() ?? undefined);
      });
      // No cleanup is returned from this apply — the live instance must survive re-applies so
      // the refresh-else-recreate path above can run against it. React 36.3's cleanup only marks
      // a pending instance stale, which the compVersion bump already does.
    },
    { name: "JsCellRenderer.lifecycle" },
  );

  // final disposal only — the update effect above deliberately keeps the comp alive
  onCleanup(() => destroyCellRenderer(false));

  return { gui, instance: () => comp };
};
