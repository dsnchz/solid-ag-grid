import type { JSX } from "@solidjs/web";
import type {
  CellCtrl,
  HorizontalSection,
  HorizontalSectionMap,
  ICellRenderer,
  ICellRendererParams,
  IRowComp,
  RowContainerType,
  RowCtrl,
  RowStyle,
  UserCompDetails,
} from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { CssClassManager } from "ag-stack";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  untrack,
  useContext,
} from "solid-js";

import CellComp from "../cells/cellComp";
import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";
import { agFlush, getNextValueIfDifferent } from "../core/utils";

type RowCompProps = {
  rowCtrl: RowCtrl;
  containerType: RowContainerType;
};

const RowComp = (props: RowCompProps) => {
  const { context, editSvc, gos } = useContext(BeansContext);

  // raw <For> items / literals — stable identity, capture once in the body (setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const rowCtrl = untrack(() => props.rowCtrl);
  const containerType = untrack(() => props.containerType);

  const isFullWidth = rowCtrl.isFullWidth();
  // embedded full-width: the full-width renderer repeats per pinned lane (embedFullWidthRows /
  // print layout); fixed for the life of the ctrl, like isFullWidth
  const showEmbeddedFullWidth = isFullWidth && rowCtrl.shouldCreateCellSections();

  // Flag used to avoid problematic initial-state reads on a dead / non-displayed row. Due to
  // async rendering it's possible for the row to be destroyed before Solid has rendered it.
  const isDisplayed = rowCtrl.rowNode.displayed;

  // signals seeded from the ctrl (Open question 7): the first template render already carries
  // index/top/transform/cells, so there is no empty-row flash and enter animations get their
  // starting values
  const [rowIndex, setRowIndex] = createSignal<string | null>(
    isDisplayed ? rowCtrl.rowNode.getRowIndexString() : null,
  );
  const [rowId, setRowId] = createSignal<string | null>(rowCtrl.rowId);
  const [rowBusinessKey, setRowBusinessKey] = createSignal<string | null>(rowCtrl.businessKey);
  const [userStyles, setUserStyles] = createSignal<RowStyle | undefined>(rowCtrl.rowStyles);

  // these styles have initial values, so the element is placed into the DOM with them, rather
  // than a transition getting applied.
  const [top, setTop] = createSignal<string | undefined>(
    isDisplayed ? rowCtrl.getInitialRowTop() : undefined,
  );
  const [transform, setTransform] = createSignal<string | undefined>(
    isDisplayed ? rowCtrl.getInitialTransform() : undefined,
  );

  let domOrder = rowCtrl.getDomOrder();
  // Seeded so bulk-add doesn't flash empty rows; getInitialCellCtrls returns null when creation
  // is deferred or not applicable.
  let cellCtrlsRef: CellCtrl[] | null = rowCtrl.getInitialCellCtrls(containerType);
  const [cellCtrls, setCellCtrls] = createSignal<CellCtrl[] | null>(cellCtrlsRef);
  const [pinnedSectionsVersion, setPinnedSectionsVersion] = createSignal(0);

  // full-width state: signals drive the JSX; the plain mirrors are read back by the compProxy
  // getters/refresh paths, which the core may call mid-flush — before pending signal writes
  // have applied (React keeps the same signal/ref split for its stale-closure reasons)
  const [fullWidthCompDetails, setFullWidthCompDetails] = createSignal<UserCompDetails>();
  const [embeddedFullWidthCompDetails, setEmbeddedFullWidthCompDetails] =
    createSignal<HorizontalSectionMap<UserCompDetails>>();
  let fullWidthCompDetailsRef: UserCompDetails | undefined;
  let embeddedFullWidthCompDetailsRef: HorizontalSectionMap<UserCompDetails> | undefined;
  let fullWidthParamsRef: ICellRendererParams | undefined;
  let fullWidthEmbeddedLeftParamsRef: ICellRendererParams | undefined;
  let fullWidthEmbeddedCenterParamsRef: ICellRendererParams | undefined;
  let fullWidthEmbeddedRightParamsRef: ICellRendererParams | undefined;
  let fullWidthComp: ICellRenderer | undefined;
  let fullWidthEmbeddedLeftComp: ICellRenderer | undefined;
  let fullWidthEmbeddedCenterComp: ICellRenderer | undefined;
  let fullWidthEmbeddedRightComp: ICellRenderer | undefined;
  let autoHeightSetup = false;
  const [autoHeightSetupAttempt, setAutoHeightSetupAttempt] = createSignal(0);

  let eGui: HTMLDivElement | undefined;
  let eFullWidthAnchor: HTMLDivElement | undefined;
  let ePinnedLeftCells: HTMLDivElement | undefined;
  let eScrollingCells: HTMLDivElement | undefined;
  let ePinnedRightCells: HTMLDivElement | undefined;
  let compBean: _EmptyBean | undefined;

  // managing classes imperatively at the row level was too slow through React's render cycle;
  // the same reasoning holds here — toggleCss stays off the reactive graph
  const cssManager = new CssClassManager(() => eGui);

  // Solid translation of React's `isComponentStateless` refresh split: all Solid comps are
  // functions, so "stateless" collapses to "never registered an imperative refresh handle".
  // A handle refresh takes precedence (its verdict may be `false` — GroupCellRenderer demands
  // a remount that way); a handle-less framework renderer gets params prop-pushed through the
  // details signal iff `reactiveCustomComponents` (params flow reactively through the spread).
  const canPropPushRenderer = (
    details: UserCompDetails | undefined,
    renderer: ICellRenderer | undefined,
  ): boolean =>
    !!details?.componentFromFramework &&
    !renderer?.refresh &&
    !!gos.get("reactiveCustomComponents");

  // ctrl.setComp only needs the row element itself: the lane elements are consumed lazily
  // through the getPinnedLeft/Scrolling/PinnedRight getters, so setComp runs directly in the
  // root ref (no guarded setup needed — see the setComp verdict in gridComp.tsx)
  const setRef = (eRef: HTMLDivElement) => {
    eGui = eRef;

    // it's possible the RowCtrl is no longer valid by the time we render. This can happen if
    // the user calls two API methods one after the other, with the second API invalidating the
    // rows the first call created.
    if (!rowCtrl.isAlive() || context.isDestroyed()) {
      return;
    }
    compBean = context.createBean(new _EmptyBean());

    const compProxy: IRowComp = {
      // the rowTop is managed by state, instead of direct style manipulation by rowCtrl (like
      // all the other styles), as we need an initial value when it's first placed into the DOM
      // for animation to work.
      setTop: (value) => setTop(value),
      setTransform: (value) => setTransform(value),

      toggleCss: (name, on) => cssManager.toggleCss(name, on),

      setDomOrder: (value) => (domOrder = value),
      setRowIndex: (value) => setRowIndex(value),
      setRowId: (value) => setRowId(value),
      setRowBusinessKey: (value) => setRowBusinessKey(value),
      setUserStyles: (styles) => setUserStyles(styles),
      // if we don't maintain the order, then cols will be ripped out of and into the dom when
      // cols are reordered, which would stop the CSS transitions from working
      setCellCtrls: (next, useFlushSync) => {
        const prevCellCtrls = cellCtrlsRef;
        const nextCells = getNextValueIfDifferent(prevCellCtrls, next, domOrder);
        if (nextCells !== prevCellCtrls) {
          cellCtrlsRef = nextCells;
          agFlush(useFlushSync, () => setCellCtrls(nextCells));
        }
      },
      getPinnedLeftRowElement: () => ePinnedLeftCells,
      getScrollingRowElement: () => eScrollingCells,
      getPinnedRightRowElement: () => ePinnedRightCells,
      refreshPinnedSections: () => setPinnedSectionsVersion((v) => v + 1),

      showFullWidth: (compDetails) => {
        embeddedFullWidthCompDetailsRef = undefined;
        setEmbeddedFullWidthCompDetails(undefined);
        fullWidthParamsRef = compDetails.params;
        fullWidthCompDetailsRef = compDetails;
        setFullWidthCompDetails(compDetails);
      },
      showEmbeddedFullWidth: (compDetails) => {
        fullWidthCompDetailsRef = undefined;
        setFullWidthCompDetails(undefined);
        fullWidthEmbeddedLeftParamsRef = compDetails.left.params;
        fullWidthEmbeddedCenterParamsRef = compDetails.center.params;
        fullWidthEmbeddedRightParamsRef = compDetails.right.params;
        embeddedFullWidthCompDetailsRef = compDetails;
        setEmbeddedFullWidthCompDetails(compDetails);
      },
      getFullWidthCellRenderers: () => {
        if (rowCtrl.isEmbeddedFullWidth) {
          return [
            fullWidthEmbeddedLeftComp,
            fullWidthEmbeddedCenterComp,
            fullWidthEmbeddedRightComp,
          ].filter((r) => r != null);
        }
        return fullWidthComp ? [fullWidthComp] : [];
      },
      getFullWidthCellRendererParams: () => fullWidthParamsRef ?? fullWidthEmbeddedCenterParamsRef,
      getFullWidthCellRendererParamsForPinned: (pinned) =>
        pinned === "left"
          ? fullWidthEmbeddedLeftParamsRef
          : pinned === "right"
            ? fullWidthEmbeddedRightParamsRef
            : fullWidthEmbeddedCenterParamsRef,
      refreshFullWidth: (getUpdatedParams) => {
        const fullWidthParams = getUpdatedParams();
        fullWidthParamsRef = fullWidthParams;
        const details = fullWidthCompDetailsRef;
        if (canPropPushRenderer(details, fullWidthComp)) {
          const nextDetails = { ...details!, params: fullWidthParams };
          fullWidthCompDetailsRef = nextDetails;
          setFullWidthCompDetails(nextDetails);
          return true;
        }
        if (!fullWidthComp?.refresh) {
          return false;
        }
        return fullWidthComp.refresh(fullWidthParams) as boolean;
      },
      refreshEmbeddedFullWidth: (getUpdatedParams) => {
        const leftParams = getUpdatedParams("left");
        const centerParams = getUpdatedParams(null);
        const rightParams = getUpdatedParams("right");

        fullWidthEmbeddedLeftParamsRef = leftParams;
        fullWidthEmbeddedCenterParamsRef = centerParams;
        fullWidthEmbeddedRightParamsRef = rightParams;

        const currentDetails = embeddedFullWidthCompDetailsRef;
        let nextDetails: HorizontalSectionMap<UserCompDetails> | undefined;

        const refreshSection = (
          section: HorizontalSection,
          params: ICellRendererParams,
          renderer: ICellRenderer | undefined,
          hasContent: boolean,
        ): boolean => {
          const details = currentDetails?.[section];

          if (details?.componentFromFramework && !renderer?.refresh) {
            if (!gos.get("reactiveCustomComponents") || !currentDetails) {
              return false;
            }

            nextDetails ??= { ...currentDetails };
            nextDetails[section] = { ...details, params };
            return true;
          }

          return (renderer?.refresh?.(params) as boolean | undefined) ?? !hasContent;
        };

        const leftRefreshed = refreshSection(
          "left",
          leftParams,
          fullWidthEmbeddedLeftComp,
          rowCtrl.embeddedSectionHasContent.left,
        );
        const centerRefreshed = refreshSection(
          "center",
          centerParams,
          fullWidthEmbeddedCenterComp,
          true,
        );
        const rightRefreshed = refreshSection(
          "right",
          rightParams,
          fullWidthEmbeddedRightComp,
          rowCtrl.embeddedSectionHasContent.right,
        );

        if (nextDetails) {
          embeddedFullWidthCompDetailsRef = nextDetails;
          setEmbeddedFullWidthCompDetails(nextDetails);
        }

        return leftRefreshed && centerRefreshed && rightRefreshed;
      },
    };
    rowCtrl.setComp(compProxy, eRef, containerType, compBean);
  };

  onCleanup(() => {
    rowCtrl.unsetComp(containerType);
    compBean = context.destroyBean(compBean);
  });

  // full-width JS (non-framework) renderer mounts into the anchor div (framework renderers
  // render inline below; showJsComp no-ops for them). Effect classification (§5.1 bridge
  // category 2): signal-keyed lifecycle of a non-Solid instance (React: useLayoutEffect).
  createEffect(
    () => fullWidthCompDetails(),
    (details) =>
      showJsComp(details, context, eFullWidthAnchor ?? eGui!, (instance) => {
        fullWidthComp = instance;
      }),
  );

  // embedded full-width JS renderers, one per lane (same classification as above)
  createEffect(
    () => embeddedFullWidthCompDetails()?.left,
    (details) => {
      if (!ePinnedLeftCells) {
        return;
      }
      return showJsComp(details, context, ePinnedLeftCells, (instance) => {
        fullWidthEmbeddedLeftComp = instance;
      });
    },
  );
  createEffect(
    () => embeddedFullWidthCompDetails()?.center,
    (details) => {
      if (!eScrollingCells) {
        return;
      }
      return showJsComp(details, context, eScrollingCells, (instance) => {
        fullWidthEmbeddedCenterComp = instance;
      });
    },
  );
  createEffect(
    () => embeddedFullWidthCompDetails()?.right,
    (details) => {
      if (!ePinnedRightCells) {
        return;
      }
      return showJsComp(details, context, ePinnedRightCells, (instance) => {
        fullWidthEmbeddedRightComp = instance;
      });
    },
  );

  // embedded lane content tracking: the core hides/sizes lanes based on whether each one has
  // real content (a framework comp may render nothing into a lane). Effect classification:
  // signal-driven lifecycle of an external DOM observer (MutationObserver).
  createEffect(
    () => embeddedFullWidthCompDetails(),
    () => {
      if (!showEmbeddedFullWidth) {
        return;
      }
      const updateLaneVisibility = () => {
        // firstElementChild, never firstChild — Solid insertions can be bracketed by marker
        // text nodes (portal identity verdict, §7.8)
        const next = {
          left: !!ePinnedLeftCells?.firstElementChild,
          center: !!eScrollingCells?.firstElementChild,
          right: !!ePinnedRightCells?.firstElementChild,
        };
        const prev = rowCtrl.embeddedSectionHasContent;
        rowCtrl.embeddedSectionHasContent = next;
        if (prev.left !== next.left || prev.center !== next.center || prev.right !== next.right) {
          // React forces a re-render here so the row re-reads the pinned lane widths; our
          // widths memo keys on the same version bump refreshPinnedSections uses
          setPinnedSectionsVersion((v) => v + 1);
        }
      };

      updateLaneVisibility();
      const observer = new MutationObserver(updateLaneVisibility);
      for (const el of [ePinnedLeftCells, eScrollingCells, ePinnedRightCells]) {
        if (el) {
          observer.observe(el, { childList: true });
        }
      }

      return () => observer.disconnect();
    },
  );

  // puts autoHeight onto full-width detail rows. this needs trickery, as we need the
  // HTMLElement of the provided Detail Cell Renderer, which may mount asynchronously (JS comps
  // resolve through AgPromise), so we poll — limited to 10 attempts — for the anchor's first
  // element child after fullWidthCompDetails is set. Effect classification: reactive → core
  // push (hands the detail element to rowCtrl.setupDetailRowAutoHeight).
  createEffect(
    () => ({ details: fullWidthCompDetails(), attempt: autoHeightSetupAttempt() }),
    ({ details, attempt }) => {
      if (autoHeightSetup || !details || attempt > 10) {
        return;
      }

      const eChild = eFullWidthAnchor?.firstElementChild as HTMLElement | null | undefined;
      if (eChild) {
        rowCtrl.setupDetailRowAutoHeight(eChild);
        autoHeightSetup = true;
      } else {
        // retry on a task boundary: unlike React (state update → new render pass), an
        // immediate signal bump would re-run inside the same flush — before an async JS comp
        // could possibly have mounted — burning all attempts at once
        setTimeout(() => setAutoHeightSetupAttempt(attempt + 1), 0);
      }
    },
  );

  const rowStyles = createMemo(() => {
    const res: JSX.CSSProperties = { top: top(), transform: transform() };
    Object.assign(res, userStyles());
    return res;
  });

  const showCells = createMemo(() => !isFullWidth && cellCtrls() != null);
  // the pinned/scrolling lanes render for normal cell rows AND embedded full-width rows
  const showLanes = createMemo(() => showCells() || showEmbeddedFullWidth);

  const partitionedCellCtrls = createMemo(() => {
    const left: CellCtrl[] = [];
    const center: CellCtrl[] = [];
    const right: CellCtrl[] = [];

    for (const cellCtrl of cellCtrls() ?? []) {
      const pinned = cellCtrl.column.getPinned();
      if (pinned === "left") {
        left.push(cellCtrl);
      } else if (pinned === "right") {
        right.push(cellCtrl);
      } else {
        center.push(cellCtrl);
      }
    }

    return { left, center, right };
  });

  // React re-reads the widths on every render; the states that trigger those renders are the
  // refreshPinnedSections bump (also bumped on embedded-lane content changes) and the cell set
  // changing, so key the memo on both
  const pinnedWidths = createMemo(() => {
    pinnedSectionsVersion();
    cellCtrls();
    return rowCtrl.getMappedPinnedCellGroupWidths();
  });

  const cellsJsx = (list: () => CellCtrl[]) => (
    <For each={list()}>
      {(cellCtrl) => (
        <CellComp
          cellCtrl={cellCtrl}
          editingCell={editSvc?.isEditing(cellCtrl, { withOpenEditor: true }) ?? false}
          printLayout={rowCtrl.printLayout}
        />
      )}
    </For>
  );

  // embedded full-width framework renderers render inline per lane; keyed on the component
  // class so params-only updates (the prop-push refresh path) flow reactively through the
  // spread without a remount
  const embeddedSectionComp = (section: HorizontalSection) => {
    const details = embeddedFullWidthCompDetails()?.[section];
    return details?.componentFromFramework ? (details.componentClass as any) : undefined;
  };

  const setEmbeddedCompRef = (section: HorizontalSection) => (instance: ICellRenderer) => {
    if (section === "left") {
      fullWidthEmbeddedLeftComp = instance;
    } else if (section === "right") {
      fullWidthEmbeddedRightComp = instance;
    } else {
      fullWidthEmbeddedCenterComp = instance;
    }
  };

  const embeddedSectionJsx = (section: HorizontalSection) => (
    <Show when={embeddedSectionComp(section)} keyed>
      {(Comp) => (
        <Comp
          {...embeddedFullWidthCompDetails()?.[section]?.params}
          ref={setEmbeddedCompRef(section)}
        />
      )}
    </Show>
  );

  // full-width framework renderer, same remount-only-on-class-change contract
  const fullWidthFrameworkComp = () => {
    const details = fullWidthCompDetails();
    return details?.componentFromFramework ? (details.componentClass as any) : undefined;
  };

  const fullWidthFrameworkJsx = () => (
    <Show when={fullWidthFrameworkComp()} keyed>
      {(Comp) => (
        <Comp
          {...fullWidthCompDetails()?.params}
          ref={(instance: ICellRenderer) => (fullWidthComp = instance)}
        />
      )}
    </Show>
  );

  return (
    <div
      ref={setRef}
      role="row"
      style={rowStyles()}
      row-index={rowIndex()}
      row-id={rowId()}
      row-business-key={rowBusinessKey()}
    >
      {/* the lane getters must return undefined once a lane unmounts (React nulls refs on
          unmount; Solid refs don't re-run) — the core reads them for embedded full-width
          targets and pinned-section hit-testing, and a stale detached element would be used.
          Show function children give a scope to register the branch cleanups in. */}
      <Show when={showLanes()}>
        {(_lanes) => {
          onCleanup(() => (eScrollingCells = undefined));
          return (
            <>
              <Show when={pinnedWidths().renderLeft}>
                {(_left) => {
                  onCleanup(() => (ePinnedLeftCells = undefined));
                  return (
                    <div
                      class="ag-grid-pinned-left-cells"
                      role="presentation"
                      style={{ width: `${pinnedWidths().leftWidth}px` }}
                    >
                      <div
                        class="ag-grid-container-wrapper"
                        role="presentation"
                        ref={(el) => (ePinnedLeftCells = el)}
                      >
                        {showEmbeddedFullWidth
                          ? embeddedSectionJsx("left")
                          : cellsJsx(() => partitionedCellCtrls().left)}
                      </div>
                    </div>
                  );
                }}
              </Show>
              <div
                class="ag-grid-scrolling-cells"
                role="presentation"
                ref={(el) => (eScrollingCells = el)}
                style={{ width: `${pinnedWidths().centerWidth}px` }}
              >
                {showEmbeddedFullWidth
                  ? embeddedSectionJsx("center")
                  : cellsJsx(() => partitionedCellCtrls().center)}
              </div>
              <Show when={pinnedWidths().renderRight}>
                {(_right) => {
                  onCleanup(() => (ePinnedRightCells = undefined));
                  return (
                    <div
                      class="ag-grid-pinned-right-cells"
                      role="presentation"
                      style={{ width: `${pinnedWidths().rightWidth}px` }}
                    >
                      <div
                        class="ag-grid-container-wrapper"
                        role="presentation"
                        ref={(el) => (ePinnedRightCells = el)}
                      >
                        {showEmbeddedFullWidth
                          ? embeddedSectionJsx("right")
                          : cellsJsx(() => partitionedCellCtrls().right)}
                      </div>
                    </div>
                  );
                }}
              </Show>
            </>
          );
        }}
      </Show>
      <Show when={isFullWidth && !showEmbeddedFullWidth}>
        <div class="ag-full-width-anchor" role="presentation" ref={(el) => (eFullWidthAnchor = el)}>
          {fullWidthFrameworkJsx()}
        </div>
      </Show>
    </div>
  );
};

export default RowComp;
