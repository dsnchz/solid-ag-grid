import type {
  GridOptions,
  IDetailCellRenderer,
  IDetailCellRendererCtrl,
  IDetailCellRendererParams,
} from "ag-grid-community";
import {
  _getGridRegisteredModules,
  _isClientSideRowModel,
  _isServerSideRowModel,
  _warn,
} from "ag-grid-community";
import { _observeResize, CssClassManager } from "ag-stack";
import { createMemo, createSignal, onCleanup, Show, untrack, useContext } from "solid-js";

import type { AgGridSolidRef } from "../agGridSolid";
import AgGridSolid from "../agGridSolid";
import { BeansContext } from "../core/beansContext";
import { CssClasses } from "../core/utils";

type DetailCellRendererProps = IDetailCellRendererParams & {
  readonly ref?: (handle: { refresh(): boolean }) => void;
};

/**
 * Framework implementation of `agDetailCellRenderer`. Port of the `DetailCellRenderer` defined
 * inline in reactUi/agGridReactUi.tsx (kept in its own file per ARCHITECTURE §1 — Solid has no
 * circular-import hazard here because nothing in this module executes at import time).
 * Drives an `IDetailCellRendererCtrl` created via
 * `registry.createDynamicBean('detailCellRendererCtrl')` (enterprise SharedMasterDetail) and
 * renders the detail grid as a nested `<AgGridSolid>`.
 *
 * NESTED-GRID VERDICT (ARCHITECTURE.md Open question 6, resolved T3.10): nested `AgGridSolid`
 * instances created during the master grid's render flush are SAFE under Solid 2.0 microtask
 * batching. The ctrl pushes `setDetailGrid` synchronously from our root ref (mid master
 * flush); the signal write applies in the same batch, mounting the nested grid's component
 * body inside the master's flush — but the nested grid *boots* in its own `onSettled`, which
 * runs after the whole batch settles, so `GridCoreCreator.create` never re-enters the master's
 * apply phase. The nested grid reads no async props here, so its `gridCreated` idempotence
 * guard (§7.9) is a belt-and-braces backstop, not load-bearing. Evidence (master-detail is
 * enterprise, so the same re-entrancy path is exercised with a community full-width renderer
 * that renders another `<AgGridSolid>` inside the master's flush — identical mechanism:
 * compProxy push during setComp → signal → nested component mounted in the same batch):
 * test/browser/groupDetailFullWidth.browser.test.tsx "nested AgGridSolid inside a full-width
 * renderer" — nested + master grids both render, master API works, and the console shows no
 * PENDING_ASYNC_FORBIDDEN_SCOPE / REACTIVE_WRITE_IN_OWNED_SCOPE / REACTIVITY_HALTED
 * diagnostics.
 */
const DetailCellRenderer = (props: DetailCellRendererProps) => {
  const beans = useContext(BeansContext);
  const { registry, context, gos, rowModel } = beans;

  // props arrive through RowComp's reactive full-width params spread (§7.1) — snapshot once.
  // Static is faithful: params changes route through the ctrl's refresh()/re-creation, not
  // through prop updates (React's per-mount props contract).
  const params = untrack(() => ({ ...props })) as DetailCellRendererProps;

  const [gridCssClasses, setGridCssClasses] = createSignal<CssClasses>(new CssClasses());
  const [detailGridOptions, setDetailGridOptions] = createSignal<GridOptions>();
  const [detailRowData, setDetailRowData] = createSignal<any[]>();

  let eGui: HTMLDivElement | undefined;
  let ctrl: IDetailCellRendererCtrl | undefined;
  let resizeObserverDestroyFunc: (() => void) | undefined;

  // root classes: ctrl pushes through toggleCss — CssClassManager + static base class per the
  // T3.9 finding (never a wholesale reactive class binding on feature-bean comp roots)
  const cssManager = new CssClassManager(() => eGui);

  // the detail grid class lands on the nested AgGridSolid's outermost div (user-owned — the
  // styled-root layers are inside it), so a reactive class string is safe there
  const gridClassName = createMemo(() => gridCssClasses().toString() + " ag-details-grid");

  const parentModules = createMemo(() =>
    _getGridRegisteredModules(
      params.api.getGridId(),
      detailGridOptions()?.rowModelType ?? "clientSide",
    ),
  );

  params.ref?.({
    refresh: () => ctrl?.refresh() ?? false,
  });

  if (params.template) {
    // core-owned message (names React, behavior identical): string templates only work for
    // frameworks that render from strings — provide a custom Solid detail cell renderer instead
    _warn(230);
  }

  const setRef = (eRef: HTMLDivElement) => {
    eGui = eRef;
    if (context.isDestroyed()) {
      return;
    }

    const compProxy: IDetailCellRenderer = {
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
      toggleDetailGridCss: (name, on) => setGridCssClasses((prev) => prev.setClass(name, on)),
      setDetailGrid: (gridOptions) => setDetailGridOptions(gridOptions),
      setRowData: (rowData) => setDetailRowData(rowData),
      getGui: () => eGui!,
    };

    const detailCtrl = registry.createDynamicBean<IDetailCellRendererCtrl>(
      "detailCellRendererCtrl",
      true,
    );
    if (!detailCtrl) {
      return; // should never happen, means master/detail module not loaded
    }
    context.createBean(detailCtrl);
    detailCtrl.init(compProxy, params);
    ctrl = detailCtrl;

    if (gos.get("detailRowAutoHeight")) {
      const checkRowSizeFunc = () => {
        // when disposed eGui is cleared, so nothing to do, and the resize observer will be
        // disposed of soon
        if (eGui == null) {
          return;
        }

        const clientHeight = eGui.clientHeight;

        // if the UI is not ready, the height can be 0, which we ignore, as otherwise a flicker
        // will occur as UI goes from the default height, to 0, then to the real height as UI
        // becomes ready. this means it's not possible to have 0 as auto-height, however this is
        // an improbable use case, as even an empty detail grid would still have some styling
        // around it giving at least a few pixels.
        if (clientHeight != null && clientHeight > 0) {
          // we do the update in a timeout, to make sure we are not calling from inside the grid
          // doing another update
          const updateRowHeightFunc = () => {
            params.node.setRowHeight(clientHeight);
            if (_isClientSideRowModel(gos, rowModel) || _isServerSideRowModel(gos, rowModel)) {
              rowModel.onRowHeightChanged();
            }
          };
          setTimeout(updateRowHeightFunc, 0);
        }
      };

      resizeObserverDestroyFunc = _observeResize(beans, eRef, checkRowSizeFunc);
      checkRowSizeFunc();
    }
  };

  onCleanup(() => {
    resizeObserverDestroyFunc?.();
    resizeObserverDestroyFunc = undefined;
    ctrl = context.destroyBean(ctrl);
    eGui = undefined;
  });

  const registerGridApi = (gridRef: AgGridSolidRef) => {
    ctrl?.registerDetailWithMaster(gridRef.api);
  };

  return (
    <div class="ag-details-row" ref={setRef}>
      <Show when={detailGridOptions()}>
        {(gridOptions) => (
          <AgGridSolid
            class={gridClassName()}
            {...gridOptions()}
            modules={parentModules()}
            rowData={detailRowData()}
            ref={registerGridApi}
          />
        )}
      </Show>
    </div>
  );
};

export default DetailCellRenderer;
