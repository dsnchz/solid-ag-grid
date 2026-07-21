import type { CellCtrl } from "ag-grid-community";
import { Show, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { createJsCellRenderer } from "./createJsCellRenderer";
import type { RenderDetails } from "./interfaces";

type SkeletonCellRendererProps = {
  cellCtrl: CellCtrl;
};

/**
 * Loading comp shown while a cell's real renderer is not ready: the fallback of the <Loading>
 * boundary around framework cell renderers (async Solid renderers suspend into it). Port of
 * reactUi/cells/skeletonCellComp.tsx; the grid resolves the comp via
 * `getDeferLoadingCellRenderer` (colDef.loadingCellRenderer or agSkeletonCellRenderer).
 */
export const SkeletonCellRenderer = (props: SkeletonCellRendererProps) => {
  // creation-time value — <Loading> fallbacks remount per boundary cycle, and the cellCtrl is
  // stable for the life of the cell (setComp verdict in gridComp.tsx)
  const cellCtrl = untrack(() => props.cellCtrl);
  const { context } = useContext(BeansContext);

  // per-mount constants: the loading comp cannot change for the life of the fallback
  // (React computes it once via useMemo([cellCtrl]))
  const { loadingComp } = cellCtrl.getDeferLoadingCellRenderer();
  const renderDetails: RenderDetails | undefined = loadingComp
    ? { value: undefined, compDetails: loadingComp, force: false }
    : undefined;

  // JS loading comps run through the shared js-renderer lifecycle (a no-op for framework or
  // missing details); the gui element inserts as derived JSX below (§5.1)
  const jsRenderer = createJsCellRenderer({ context, renderDetails: () => renderDetails });

  const frameworkLoadingComp = loadingComp?.componentFromFramework ? loadingComp : undefined;

  return (
    <>
      <Show when={frameworkLoadingComp} keyed>
        {(details) => <details.componentClass {...details.params} />}
      </Show>
      {jsRenderer.gui()}
    </>
  );
};
