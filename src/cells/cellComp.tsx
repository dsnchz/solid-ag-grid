import type { JSX } from "@solidjs/web";
import type { CellCtrl, CellStyle, ICellComp } from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { CssClassManager } from "ag-stack";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  untrack,
  useContext,
} from "solid-js";

import { BeansContext } from "../core/beansContext";
import type { RenderDetails } from "./interfaces";

let editorsNotSupportedWarned = false;
const warnEditorsNotSupported = () => {
  if (!editorsNotSupportedWarned) {
    editorsNotSupportedWarned = true;
    console.warn("AG Grid (solid-ag-grid): cell editors are not supported yet (arriving in T3.8)");
  }
};

interface CellCompProps {
  cellCtrl: CellCtrl;
  printLayout: boolean;
  editingCell: boolean;
}

/** Identity key for the mounted framework cell renderer: remount only on class/renderKey change. */
interface FrameworkRendererInfo {
  Comp: any;
  key: number;
}

const CellComp = (props: CellCompProps) => {
  const { context } = useContext(BeansContext);

  // raw <For> items / creation-time values — capture once in the body (setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const cellCtrl = untrack(() => props.cellCtrl);
  const printLayout = untrack(() => props.printLayout);
  const editingCell = untrack(() => props.editingCell);

  const { colIdSanitised } = cellCtrl.column;
  const { instanceId } = cellCtrl;

  let compBean: _EmptyBean | undefined;

  // Only provide an initial state when not using a Cell Renderer so that we do not display a
  // raw value before the cell renderer is created.
  const [renderDetails, setRenderDetails] = createSignal<RenderDetails | undefined>(
    cellCtrl.isCellRenderer()
      ? undefined
      : { compDetails: undefined, value: cellCtrl.getValueToDisplay(), force: false },
  );
  const [renderKey, setRenderKey] = createSignal<number>(1);

  const [userStyles, setUserStyles] = createSignal<CellStyle>();

  // T3.5 renders the actual tool widgets; the signals exist now so the wrapper branch is real
  const [includeSelection, setIncludeSelection] = createSignal<boolean>(false);
  const [includeRowDrag, setIncludeRowDrag] = createSignal<boolean>(false);
  const [includeDndSource, setIncludeDndSource] = createSignal<boolean>(false);

  const forceWrapper = cellCtrl.isForceWrapper();
  const cellAriaRole = cellCtrl.getCellAriaRole() as JSX.AriaAttributes["role"];
  const cellValueClass = cellCtrl.getCellValueClass();
  const isSpanning = cellCtrl.isCellSpanning();

  let eGui: HTMLDivElement | undefined;
  let eWrapper: HTMLDivElement | undefined;
  let eCellWrapper: HTMLDivElement | undefined;
  let eCellValue: HTMLElement | undefined;
  let cellRendererRef: any = null;

  const cssManager = new CssClassManager(() => eGui);

  // editDetails is always undefined until T3.8, so the React showTools edit guard collapses
  const showTools = createMemo(
    () => renderDetails() != null && (includeSelection() || includeDndSource() || includeRowDrag()),
  );
  const showCellWrapper = createMemo(() => forceWrapper || showTools());

  // ctrl.setComp needs the root cell element plus (when present) the spanned wrapper and the
  // ag-cell-wrapper, whose refs are applied parent-before-children — guarded setup fires once
  // every element the initial markup renders exists (same pattern as HeaderCellComp.setup)
  const init = () => {
    if (compBean) {
      return;
    }
    const spanReady = !isSpanning || eWrapper;
    const cellWrapperReady = !forceWrapper || eCellWrapper;
    if (!eGui || !spanReady || !cellWrapperReady) {
      return;
    }
    if (!cellCtrl.isAlive() || context.isDestroyed()) {
      return;
    }
    compBean = context.createBean(new _EmptyBean());

    const compProxy: ICellComp = {
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
      setUserStyles: (styles: CellStyle) => setUserStyles(styles),
      getFocusableElement: () => eGui!,

      setIncludeSelection: (include) => setIncludeSelection(include),
      setIncludeRowDrag: (include) => setIncludeRowDrag(include),
      setIncludeDndSource: (include) => setIncludeDndSource(include),
      // T3.5: row resizer element handling
      setRowResizerElement: () => {},

      // T3.8: editors
      getCellEditor: () => null,
      // T3.5 adds the JS renderer instance fallback
      getCellRenderer: () => cellRendererRef ?? null,
      getParentOfValue: () => eCellValue ?? eCellWrapper ?? eGui ?? null,

      setRenderDetails: (compDetails, value, force) => {
        const setDetails = () => {
          // identity-preserving update: keep the previous object when nothing changed so
          // downstream memos/effects don't re-fire
          setRenderDetails((prev) => {
            if (
              prev?.compDetails !== compDetails ||
              prev?.value !== value ||
              prev?.force !== force
            ) {
              return { value, compDetails, force };
            }
            return prev;
          });
        };
        if (compDetails?.params?.deferRender && !cellCtrl.rowNode.group) {
          const { loadingComp, onReady } = cellCtrl.getDeferLoadingCellRenderer();
          if (loadingComp) {
            // simplified defer branch (no startTransition equivalent in Solid 2.0 — see
            // ARCHITECTURE.md Open question 3): show the loading comp, swap when ready
            setRenderDetails({ value: undefined, compDetails: loadingComp, force: false });
            onReady.then(() => setDetails());
            return;
          }
        }
        setDetails();
      },

      // T3.8: editors — warn and ignore so an accidental edit doesn't crash the grid
      setEditDetails: (compDetails) => {
        if (compDetails) {
          warnEditorsNotSupported();
        }
      },
      refreshEditStyles: (editing, isPopup) => {
        if (!eGui) {
          return;
        }
        cssManager.toggleCss("ag-cell-value", !untrack(showCellWrapper));
        cssManager.toggleCss("ag-cell-inline-editing", !!editing && !isPopup);
        cssManager.toggleCss("ag-cell-popup-editing", !!editing && !!isPopup);
        cssManager.toggleCss("ag-cell-not-inline-editing", !editing || !!isPopup);
      },
    };

    cellCtrl.setComp(compProxy, eGui, eWrapper, eCellWrapper, printLayout, editingCell, compBean);
  };

  // no unsetComp — like React, destroying the compBean detaches everything the ctrl attached
  // on the comp's behalf
  onCleanup(() => {
    compBean = context.destroyBean(compBean);
  });

  // if RenderDetails changed, need to call refresh. This is not our preferred way (the
  // preferred way is to let the new params propagate to the Solid cell renderer) however we do
  // this for backwards compatibility, as having refresh used to be supported.
  // Effect classification: signal-keyed lifecycle bridge to the non-Solid renderer instance
  // (calls its imperative refresh(); the renderKey bump remounts it when refresh declines).
  let lastRenderDetails: RenderDetails | undefined;
  createEffect(
    () => renderDetails(),
    (newDetails) => {
      const oldDetails = lastRenderDetails;
      lastRenderDetails = newDetails;

      // Skip unless we have a real renderDetails change. A wrapper-only change (same inner
      // compDetails ref, new wrapper object) would otherwise drive an infinite update loop:
      // refresh() → renderKey bump → renderer remount → cellCtrl re-emits compDetails → repeat.
      const oldCompDetails = oldDetails?.compDetails;
      const newCompDetails = newDetails?.compDetails;
      if (oldCompDetails == null || newCompDetails == null || oldCompDetails === newCompDetails) {
        return;
      }

      // T3.5: rowDragComp.refreshVisibility()

      // if different Cell Renderer, then do nothing, as renderer will be recreated
      if (oldCompDetails.componentClass != newCompDetails.componentClass) {
        return;
      }

      // if no refresh method, do nothing (params flow reactively into the mounted comp)
      if (cellRendererRef?.refresh == null) {
        return;
      }

      const result = cellRendererRef.refresh(newCompDetails.params);
      if (result != true) {
        // increasing the render key forces a remount (undocumented refresh()-returns-false
        // contract kept for GroupCellRenderer parity — see the React source)
        setRenderKey((prev) => prev + 1);
      }
    },
  );

  // editing-style classes live on the imperative CssClassManager (they must compose with the
  // classes the ctrl pushes through toggleCss, so they cannot be derived JSX `class`).
  // Effect classification: signal-driven imperative DOM bridge (CssClassManager instance).
  createEffect(
    () => ({ wrapper: showCellWrapper() }),
    ({ wrapper }) => {
      if (!eGui) {
        return;
      }
      cssManager.toggleCss("ag-cell-value", !wrapper);
      // T3.8: editDetails-driven variants; no editor can be active yet
      cssManager.toggleCss("ag-cell-inline-editing", false);
      cssManager.toggleCss("ag-cell-popup-editing", false);
      cssManager.toggleCss("ag-cell-not-inline-editing", true);
    },
  );

  // remount the framework renderer ONLY when the component class or renderKey changes; param
  // updates flow reactively through the spread (Solid analog of React's key + prop propagation)
  const frameworkRendererInfo = createMemo<FrameworkRendererInfo | undefined>(
    () => {
      const compDetails = renderDetails()?.compDetails;
      if (!compDetails?.componentFromFramework) {
        return undefined;
      }
      return { Comp: compDetails.componentClass, key: renderKey() };
    },
    { equals: (a, b) => a?.Comp === b?.Comp && a?.key === b?.key },
  );

  const rendererParams = () => renderDetails()?.compDetails?.params;

  const rawValueMode = createMemo(() => {
    const details = renderDetails();
    return details != null && details.compDetails == null;
  });

  const rawValue = () => {
    const value = renderDetails()?.value;
    // if we didn't do this, objects would render incorrectly. we depend on objects for things
    // like the aggregation functions avg and count, which return objects and depend on
    // toString() getting called.
    return value?.toString?.() ?? value;
  };

  const valueOrCellCompJsx = () => (
    <>
      <Show when={rawValueMode()}>{rawValue()}</Show>
      <Show when={frameworkRendererInfo()} keyed>
        {(info) => (
          <info.Comp {...rendererParams()} ref={(instance: any) => (cellRendererRef = instance)} />
        )}
      </Show>
      {/* T3.5: JS cell renderers are mounted imperatively (showJsRenderer) */}
    </>
  );

  // T3.8: editDetails branches (jsxEditValue / popup editor) render here
  const showCellJsx = () => (
    <Show
      when={showCellWrapper()}
      fallback={<Show when={renderDetails()}>{valueOrCellCompJsx()}</Show>}
    >
      <div
        class="ag-cell-wrapper"
        role="presentation"
        ref={(el) => {
          eCellWrapper = el;
          init();
        }}
      >
        <Show when={renderDetails()}>
          <span
            role="presentation"
            id={`cell-${instanceId}`}
            class={cellValueClass}
            ref={(el) => (eCellValue = el)}
          >
            {valueOrCellCompJsx()}
          </span>
        </Show>
      </div>
    </Show>
  );

  const renderCellJsx = () => (
    <div
      ref={(el) => {
        eGui = el;
        init();
      }}
      style={userStyles()}
      role={cellAriaRole}
      col-id={colIdSanitised}
    >
      {showCellJsx()}
    </div>
  );

  // isSpanning is fixed for the life of the ctrl (a span-context change rebuilds the CellCtrl,
  // which remounts this comp via <For>), so a static branch is correct — not a reactivity bug
  // eslint-disable-next-line solid/components-return-once -- non-reactive branch on a per-ctrl constant
  return isSpanning ? (
    <div
      ref={(el) => {
        eWrapper = el;
        init();
      }}
      class="ag-spanned-cell-wrapper"
      role="presentation"
    >
      {renderCellJsx()}
    </div>
  ) : (
    renderCellJsx()
  );
};

export default CellComp;
