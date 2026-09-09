import type { JSX } from "@solidjs/web";
import type {
  CellCtrl,
  CellStyle,
  Component as AgComponent,
  Context,
  ICellComp,
  ICellEditor,
  ICellEditorComp,
  RowDragComp,
} from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { _addStylesToElement, _removeFromParent, CssClassManager } from "ag-stack";
import {
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  Loading,
  onCleanup,
  runWithOwner,
  Show,
  untrack,
} from "solid-js";

import { CellEditorComponentProxy } from "../customComp/cellEditorComponentProxy";
import { warnReactiveCustomComponents } from "../customComp/util";
import { jsxEditValue } from "./cellEditorComp";
import type { JsCellRenderer } from "./createJsCellRenderer";
import { createJsCellRenderer } from "./createJsCellRenderer";
import type { EditDetails, RenderDetails } from "./interfaces";
import { SkeletonCellRenderer } from "./skeletonCellComp";

type CellCompProps = {
  cellCtrl: CellCtrl;
  printLayout: boolean;
  editingCell: boolean;
  /** the grid Context, handed down by RowComp — saves a per-cell owner-chain context lookup */
  context: Context;
};

/** Identity key for the mounted framework cell renderer: remount only on class/renderKey change. */
type FrameworkRendererInfo = {
  Comp: any;
  key: number;
};

/** getGui() elements of the live tool widget beans, inserted as derived JSX ahead of the value. */
type ToolWidgetElements = {
  rowDrag?: HTMLElement;
  dnd?: HTMLElement;
  selection?: HTMLElement;
};

const CellComp = (props: CellCompProps) => {
  // raw <For> items / creation-time values — capture once in the body (setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const context = untrack(() => props.context);
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
  const [editDetails, setEditDetails] = createSignal<EditDetails | undefined>();
  const [renderKey, setRenderKey] = createSignal<number>(1);
  // bumped by CellEditorComponentProxy's refreshProps — drives the reactive editor-props
  // spread in jsxEditorProxy (Solid analog of React's setRenderKey re-render on refreshProps)
  const [editorParamsVersion, setEditorParamsVersion] = createSignal(0);

  const [includeSelection, setIncludeSelection] = createSignal<boolean>(false);
  const [includeRowDrag, setIncludeRowDrag] = createSignal<boolean>(false);
  const [includeDndSource, setIncludeDndSource] = createSignal<boolean>(false);

  // internal bridge signal: the JS-editor effect's cleanup clears it via AgPromise.then, which
  // resolves SYNCHRONOUSLY on an already-settled promise — at disposal that is an owned scope,
  // where writes throw REACTIVE_WRITE_IN_OWNED_SCOPE in dev (§7.3a) — opt in narrowly
  const [jsEditorComp, setJsEditorComp] = createSignal<ICellEditorComp | undefined>(undefined, {
    ownedWrite: true,
  });

  const forceWrapper = cellCtrl.isForceWrapper();
  const cellAriaRole = cellCtrl.getCellAriaRole() as JSX.AriaAttributes["role"];
  const cellValueClass = cellCtrl.getCellValueClass();
  const isSpanning = cellCtrl.isCellSpanning();

  let eGui: HTMLDivElement | undefined;
  let eWrapper: HTMLDivElement | undefined;
  let eCellWrapper: HTMLDivElement | undefined;
  let eCellValue: HTMLElement | undefined;
  let cellRendererRef: any = null;
  let cellEditorRef: ICellEditor | undefined;
  let rowResizerElement: HTMLElement | null = null;
  let rowDragComp: RowDragComp | undefined;

  const cssManager = new CssClassManager(() => eGui);

  // EDITING CLASSES ARE EVENT-DRIVEN WRITES (§5.1: compProxy setters are writes, not effects;
  // per-cell diet 3/5). The four classes compose with the ones the ctrl pushes through
  // toggleCss, so they cannot be derived JSX `class`. Vanilla writes them in refreshWrapper /
  // refreshEditStyles at construction and on each edit transition; here the same three
  // sites exist and are the ONLY places editDetails / the wrapper change: init() (mount,
  // after setComp — CssClassManager records state even before eGui exists, so never
  // earlier), the setEditDetails proxy method (edit start/stop), and the cell-wrapper <Show>
  // branch (mount/cleanup toggles ag-cell-value). No subscription is needed for a state
  // whose every writer is ours.
  const applyEditClasses = (details: EditDetails | undefined) => {
    if (!eGui) {
      return;
    }
    cssManager.toggleCss("ag-cell-inline-editing", !!details && !details.popup);
    cssManager.toggleCss("ag-cell-popup-editing", !!details && !!details.popup);
    cssManager.toggleCss("ag-cell-not-inline-editing", !details || !!details.popup);
  };

  // the ag-cell-wrapper renders when tool widgets are present (and the value is visible —
  // inline editing hides tools) or the ctrl forces it; one memo, one equality cut
  const showCellWrapper = createMemo(
    () =>
      forceWrapper ||
      (renderDetails() != null &&
        (includeSelection() || includeDndSource() || includeRowDrag()) &&
        (editDetails() == null || !!editDetails()!.popup)),
  );

  // the JS renderer is torn down while an inline (non-popup) editor is active
  const suppressJsRenderer = () => {
    const details = editDetails();
    return details != null && !details.popup;
  };

  const setCellEditorRef = (cellEditor: ICellEditor | undefined) => {
    cellEditorRef = cellEditor;
    if (cellEditor) {
      setTimeout(() => {
        // RUN-ONCE DIVERGENCE vs React (documented per T3.7 warning): React captures
        // `isCancelBeforeStart()` eagerly at setRef time — for the reactive proxy that runs
        // BEFORE the editor component body has registered its callbacks (useGridCellEditor →
        // setMethods), so the eager read can never see them; React's per-render re-runs paper
        // over other ordering gaps but not this one. Solid components run once, so we evaluate
        // inside the deferred turn, after the editor component (and its setMethods) has run —
        // which also matches the vanilla comp's post-creation evaluation order.
        // the edit session may already be over by this turn (stopEditing in the same tick,
        // grid destroyed) — the core's tooltip/attached paths then dereference torn-down beans
        if (cellEditorRef !== cellEditor || !cellCtrl.isAlive() || context.isDestroyed()) {
          return;
        }
        const editingCancelledByUserComp = cellEditor.isCancelBeforeStart?.();
        if (editingCancelledByUserComp) {
          cellCtrl.stopEditing(true);
          cellCtrl.focusCell(true);
        } else {
          cellCtrl.cellEditorAttached();
          cellCtrl.enableEditorTooltipFeature(cellEditor);
        }
      });
    }
  };

  // JS (non-framework) renderer instance lifecycle; its gui inserts as derived JSX in the
  // value slot below, so React's eCellValue/cellValueVersion re-run plumbing is not needed.
  // LAZY (per-cell diet): the lifecycle effect + gui signal are created under this component's
  // owner the first time a non-framework compDetails arrives (setRenderDetails is the only
  // writer), so a plain-value or framework-renderer cell never creates them. The insert reads
  // `jsGui`, a plain signal that exists from mount and is bridged from the renderer's gui.
  // isCellRenderer() cannot gate this at mount: refreshShouldDestroy does not cover renderer
  // changes, so a column may gain a renderer in place.
  const owner = getOwner();
  const [jsGui, setJsGui] = createSignal<HTMLElement | undefined>(undefined, {
    ownedWrite: true,
  });
  let jsRenderer: JsCellRenderer | undefined;
  const ensureJsRenderer = () => {
    if (jsRenderer || context.isDestroyed()) {
      return;
    }
    runWithOwner(owner, () => {
      const renderer = createJsCellRenderer({
        context,
        renderDetails,
        suppress: suppressJsRenderer,
      });
      // bridge (cleanup-free: an effect callback may only return a function or undefined)
      createEffect(
        () => renderer.gui(),
        (gui) => {
          setJsGui(gui);
        },
      );
      jsRenderer = renderer;
    });
  };

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
      // additive direct style write, like vanilla (core-jurisdiction attribute law, see RowComp)
      setUserStyles: (styles: CellStyle) => _addStylesToElement(eGui!, styles),
      getFocusableElement: () => eGui!,

      setIncludeSelection: (include) => setIncludeSelection(include),
      setIncludeRowDrag: (include) => setIncludeRowDrag(include),
      setIncludeDndSource: (include) => setIncludeDndSource(include),
      // the row resizer element is created and owned by the ctrl (rowResizeFeature); the comp
      // only parents it — plain imperative DOM work, off the reactive graph like React
      setRowResizerElement: (element) => {
        if (rowResizerElement) {
          _removeFromParent(rowResizerElement);
        }
        rowResizerElement = element;
        if (element && eGui) {
          eGui.appendChild(element);
        }
      },

      getCellEditor: () => cellEditorRef ?? null,
      getCellRenderer: () => cellRendererRef ?? jsRenderer?.instance() ?? null,
      getParentOfValue: () => eCellValue ?? eCellWrapper ?? eGui ?? null,

      setRenderDetails: (compDetails, value, force) => {
        if (compDetails != null && !compDetails.componentFromFramework) {
          ensureJsRenderer();
        }
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
            // DEFER-RENDER VERDICT (ARCHITECTURE.md Open question 3, resolved T3.5): shipped
            // WITHOUT a startTransition equivalent (removed in Solid 2.0) — show the loading
            // comp, swap with a plain write when onReady resolves (bodyScrollEnd while
            // scrolling; immediately otherwise). Browser test "defer render" scrolls a grid
            // of deferRender cells with zero console errors and correct final content; the
            // swap is one microtask batch, so there is no interleaved frame. Revisit only if
            // profiling real apps shows scroll jank from heavy renderers.
            // the loading comp is a JS comp (agSkeletonCellRenderer / colDef.loadingCellRenderer)
            // even when the real renderer is a framework one — it needs the JS machinery too
            if (!loadingComp.componentFromFramework) {
              ensureJsRenderer();
            }
            setRenderDetails({ value: undefined, compDetails: loadingComp, force: false });
            onReady.then(() => setDetails());
            return;
          }
        }
        setDetails();
      },

      setEditDetails: (compDetails, popup, popupPosition, reactiveCustomComponents) => {
        if (compDetails) {
          let editorProxy: CellEditorComponentProxy | undefined;
          if (compDetails.componentFromFramework) {
            if (reactiveCustomComponents) {
              editorProxy = new CellEditorComponentProxy(compDetails.params!, () =>
                setEditorParamsVersion((prev) => prev + 1),
              );
            } else {
              warnReactiveCustomComponents();
            }
          }
          // start editing
          const details = { compDetails, popup, popupPosition, compProxy: editorProxy };
          setEditDetails(details);
          applyEditClasses(details);
          if (!popup) {
            setRenderDetails(undefined);
          }
        } else {
          // if leaving editor & editor is focused, move focus to the cell
          const recoverFocus = cellCtrl.hasBrowserFocus();
          if (recoverFocus) {
            compProxy.getFocusableElement().focus({ preventScroll: true });
          }
          // clear the cellEditorRef SYNCHRONOUSLY so the editService never sees a stale
          // editor via getCellEditor — the JS-editor effect clears it again after the
          // microtask flush, and the reactive proxy has no other clearing path (React's
          // source notes the same regression)
          cellEditorRef = undefined;
          setEditDetails(undefined);
          applyEditClasses(undefined);
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
    // mount-time classes, after setComp like vanilla's constructor order; the wrapper branch
    // (if any) already mounted before this ref fired and toggled ag-cell-value itself
    cssManager.toggleCss("ag-cell-value", !untrack(showCellWrapper));
    applyEditClasses(untrack(editDetails));
  };

  // no unsetComp — like React, destroying the compBean detaches everything the ctrl attached
  // on the comp's behalf
  onCleanup(() => {
    compBean = context.destroyBean(compBean);
  });

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

  // raw value: rendered when there is no cell renderer at all (compDetails == null). Inserted
  // as the framework Show's fallback together with the JS renderer's element (`?? jsGui()`):
  // the two are mutually exclusive by construction (raw ⇔ compDetails == null, JS element ⇔ a
  // non-framework compDetails), so one reactive insert serves both — no second <Show>, no
  // second insert per cell (per-cell diet 5/5)
  const rawValue = () => {
    const details = renderDetails();
    if (details == null || details.compDetails != null) {
      return undefined;
    }
    const value = details.value;
    // if we didn't do this, objects would render incorrectly. we depend on objects for things
    // like the aggregation functions avg and count, which return objects and depend on
    // toString() getting called.
    return value?.toString?.() ?? value;
  };

  // ASYNC-RENDERER VERDICT (ARCHITECTURE.md Open question 4, resolved T3.5): <Loading> around
  // the framework renderer WORKS — a user renderer reading an async computation (e.g.
  // `createMemo(() => fetch(...))`) suspends into the per-cell boundary, which shows the
  // grid's loading cell renderer (SkeletonCellRenderer → colDef.loadingCellRenderer /
  // agSkeletonCellRenderer) and reveals the real content when the read settles. Zero-ceremony
  // async cell renderers are therefore supported natively (headline feature). Evidence:
  // browser test "async framework cell renderer" in cellsComplete.browser.test.tsx.
  const valueOrCellCompJsx = () => (
    <>
      <Show when={frameworkRendererInfo()} keyed fallback={rawValue() ?? jsGui()}>
        {(info) => {
          // if RenderDetails changed, need to call refresh. This is not our preferred way (the
          // preferred way is to let the new params propagate to the Solid cell renderer)
          // however we do this for backwards compatibility, as having refresh used to be
          // supported. Effect classification: signal-keyed lifecycle bridge to the mounted
          // renderer instance (calls its imperative refresh(); the renderKey bump remounts it
          // when refresh declines) — SCOPED to this renderer's branch (per-cell diet 4/5):
          // only a mounted framework renderer can carry a refresh handle, so plain-value and
          // JS-renderer cells never create it, and a remount (new keyed branch) starts it
          // fresh. Solid ordering is preserved: the prop spread applies before this effect
          // runs, so refresh(params) sees props that already carry the new value (pinned in
          // test/unit/cellRendererRefresh.test.tsx). `prev` replaces React's previous-value
          // ref; the first run has none and is a no-op, like before.
          createEffect(
            () => renderDetails()?.compDetails,
            (compDetails, prev) => {
              // Skip unless we have a real compDetails change. A wrapper-only change (same
              // inner compDetails ref, new wrapper object) would otherwise drive an infinite
              // update loop: refresh() → renderKey bump → renderer remount → cellCtrl
              // re-emits compDetails → repeat.
              if (prev == null || compDetails == null || compDetails === prev) {
                return;
              }
              // if different Cell Renderer, then do nothing, as renderer will be recreated
              if (prev.componentClass != compDetails.componentClass) {
                return;
              }
              // if no refresh method, do nothing (params flow reactively into the mounted comp)
              if (cellRendererRef?.refresh == null) {
                return;
              }
              const result = cellRendererRef.refresh(compDetails.params);
              if (result != true) {
                // increasing the render key forces a remount (undocumented
                // refresh()-returns-false contract kept for GroupCellRenderer parity — see the
                // React source)
                setRenderKey((prev) => prev + 1);
              }
            },
          );
          return (
            <Loading fallback={<SkeletonCellRenderer cellCtrl={cellCtrl} />}>
              <info.Comp
                {...rendererParams()}
                ref={(instance: any) => (cellRendererRef = instance)}
              />
            </Loading>
          );
        }}
      </Show>
    </>
  );

  // React renders the cell value alongside the editor only for popup editing; inline editing
  // replaces it (setRenderDetails(undefined) clears it in the same batch — this guard keeps
  // structural parity for the transition frame)
  const cellValueVisible = () => {
    const details = editDetails();
    return details == null || !!details.popup;
  };

  const valueVisible = () => cellValueVisible() && renderDetails() != null;

  // no wrapper: the value content sits directly in the cell (the cell carries ag-cell-value)
  const bareValueJsx = () => <Show when={valueVisible()}>{valueOrCellCompJsx()}</Show>;

  // wrapper: the value content sits in the ag-cell-value span, absent while inline editing
  // (vanilla's takeCellValueOut). getParentOfValue must stop returning the span once it
  // unmounts (React nulls the ref on unmount; Solid refs don't re-run) — Show function
  // children give a scope to register the branch cleanup in. The outer wrapper decision is
  // made ONCE by showCellJsx; the former inner wrapper <Show> here was provably redundant
  // inside either branch (per-cell diet 5/5).
  const spanValueJsx = () => (
    <Show when={valueVisible()}>
      {(_visible) => {
        onCleanup(() => (eCellValue = undefined));
        return (
          <span
            role="presentation"
            id={`cell-${instanceId}`}
            class={cellValueClass}
            ref={(el) => (eCellValue = el)}
          >
            {valueOrCellCompJsx()}
          </span>
        );
      }}
    </Show>
  );

  // framework inline editor / popup editor branches; JS inline editors mount imperatively via
  // the JS-editor effect above (jsxEditValue returns null for them)
  const showEditValueJsx = () => (
    <Show when={editDetails()} keyed>
      {(details) => {
        // JS (non-framework) editor: instance creation via newAgStackInstance, inline gui
        // attach + afterGuiAttached, destruction when the edit session ends. Effect
        // classification (§5.1 bridge category 2): signal-keyed lifecycle of a non-Solid
        // instance — SCOPED to the edit session: the keyed <Show> branch is the owner, so the
        // effect exists only while this cell is being edited and its cleanup runs when the
        // branch is disposed (editDetails changes or clears). A cell that is never edited
        // never creates it (per-cell diet, PERF: reactiveGraphBudget.test.tsx).
        if (!details.compDetails.componentFromFramework && !context.isDestroyed()) {
          createEffect(
            () => undefined,
            () => {
              const compDetails = details.compDetails;
              const isPopup = details.popup === true;

              const cellEditorPromise = compDetails.newAgStackInstance();

              cellEditorPromise.then((cellEditor: ICellEditorComp) => {
                if (!cellEditor) {
                  return;
                }

                const compGui = cellEditor.getGui();

                setCellEditorRef(cellEditor);

                if (!isPopup) {
                  const parentEl = forceWrapper ? eCellWrapper : eGui;
                  parentEl?.appendChild(compGui);

                  cellEditor.afterGuiAttached?.();
                }

                setJsEditorComp(cellEditor);
              });

              return () => {
                // AgPromise.then resolves synchronously on a settled promise, so this body runs
                // inline here — including at disposal, which is why jsEditorComp has ownedWrite
                cellEditorPromise.then((cellEditor: ICellEditorComp) => {
                  const compGui = cellEditor.getGui();
                  cellCtrl.disableEditorTooltipFeature();
                  context.destroyBean(cellEditor);
                  setCellEditorRef(undefined);
                  setJsEditorComp(undefined);

                  compGui?.remove();
                });
              };
            },
          );
        }
        return jsxEditValue(
          details,
          setCellEditorRef,
          eGui!,
          cellCtrl,
          jsEditorComp,
          editorParamsVersion,
        );
      }}
    </Show>
  );

  const showCellJsx = () => (
    <Show
      when={showCellWrapper()}
      fallback={
        <>
          {bareValueJsx()}
          {showEditValueJsx()}
        </>
      }
    >
      {(_wrapper) => {
        // same unmount-clearing contract as eCellValue above; the wrapper's presence IS the
        // ag-cell-value class state (vanilla refreshWrapper: toggleCss("ag-cell-value",
        // !usingWrapper)), so the branch writes it on mount and restores it on cleanup
        cssManager.toggleCss("ag-cell-value", false);
        onCleanup(() => {
          eCellWrapper = undefined;
          cssManager.toggleCss("ag-cell-value", true);
        });

        // Tool widgets (row drag / dnd source / selection checkbox) are JS component beans.
        // React creates them in the cell-wrapper ref callback and inserts 'afterbegin' (final
        // DOM order: rowDrag, dnd, selection, value) — Solid refs don't re-run on signal
        // changes, so the instance lifecycle is an effect and the getGui() elements insert as
        // derived JSX ahead of the value span in that same order (§5.1: derived JSX insertion
        // beats effect-appendChild). Effect classification: signal-keyed lifecycle of
        // non-Solid instances — SCOPED to the wrapper branch (per-cell diet 2/5): the wrapper
        // exists exactly when tools (or forceWrapper) do, so a plain cell never creates this.
        // internal bridge signal: the cleanup also runs at branch disposal (owned scope, where
        // writes throw REACTIVE_WRITE_IN_OWNED_SCOPE in dev) — opt in narrowly
        const [toolWidgets, setToolWidgets] = createSignal<ToolWidgetElements | undefined>(
          undefined,
          { ownedWrite: true },
        );
        createEffect(
          () => ({
            selection: includeSelection(),
            dnd: includeDndSource(),
            rowDrag: includeRowDrag(),
          }),
          (include) => {
            if (!cellCtrl.isAlive() || context.isDestroyed()) {
              return;
            }

            const comps: AgComponent[] = [];
            const widgets: ToolWidgetElements = {};
            const addComp = (slot: keyof ToolWidgetElements, comp: AgComponent | undefined) => {
              if (comp) {
                comps.push(comp);
                widgets[slot] = comp.getGui();
              }
            };

            if (include.selection) {
              addComp("selection", cellCtrl.createSelectionCheckbox());
            }
            if (include.dnd) {
              addComp("dnd", cellCtrl.createDndSource());
            }
            if (include.rowDrag) {
              rowDragComp = cellCtrl.createRowDragComp();
              addComp("rowDrag", rowDragComp);
              rowDragComp?.refreshVisibility();
            }
            setToolWidgets(widgets);

            return () => {
              setToolWidgets(undefined);
              rowDragComp = undefined;
              for (const comp of comps) {
                // Solid removes the inserted elements when the signal clears / the wrapper
                // unmounts
                context.destroyBean(comp);
              }
            };
          },
        );
        // the drag handle re-evaluates its visibility when the cell's compDetails change
        // (React: in the refresh layout effect, for every cell; here only a drag cell pays)
        if (untrack(includeRowDrag)) {
          createEffect(
            () => renderDetails()?.compDetails,
            (compDetails, prev) => {
              if (prev != null && compDetails != null && compDetails !== prev) {
                rowDragComp?.refreshVisibility();
              }
            },
          );
        }
        return (
          <div
            class="ag-cell-wrapper"
            role="presentation"
            ref={(el) => {
              eCellWrapper = el;
              init();
            }}
          >
            {toolWidgets()?.rowDrag}
            {toolWidgets()?.dnd}
            {toolWidgets()?.selection}
            {spanValueJsx()}
            {showEditValueJsx()}
          </div>
        );
      }}
    </Show>
  );

  const renderCellJsx = () => (
    <div
      ref={(el) => {
        eGui = el;
        init();
      }}
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
