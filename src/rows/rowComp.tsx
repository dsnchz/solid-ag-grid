import type {
  CellCtrl,
  HorizontalSection,
  HorizontalSectionMap,
  ICellRenderer,
  ICellRendererParams,
  IRowComp,
  RowCtrl,
  UserCompDetails,
} from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { _addStylesToElement, CssClassManager } from "ag-stack";
import { createEffect, createSignal, For, onCleanup, Show, untrack, useContext } from "solid-js";

import CellComp from "../cells/cellComp";
import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";
import { agFlush, getNextValueIfDifferent } from "../core/utils";

type RowCompProps = {
  rowCtrl: RowCtrl;
};

/** The cells shown in the pinned-left, scrolling and pinned-right lanes, in that order. */
type LaneCells = readonly [CellCtrl[] | undefined, CellCtrl[] | undefined, CellCtrl[] | undefined];

const RowComp = (props: RowCompProps) => {
  const { context, editSvc, gos } = useContext(BeansContext);

  // raw <For> item — stable identity, capture once in the body (setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const rowCtrl = untrack(() => props.rowCtrl);

  const isFullWidth = rowCtrl.isFullWidth();
  // fixed for the life of the ctrl, like isFullWidth: a loading row's anchor stands in as the
  // gridcell that role="row" requires
  const fullWidthAnchorRole = rowCtrl.getFullWidthAnchorRole();
  // embedded full-width: the full-width renderer repeats per pinned lane (embedFullWidthRows /
  // print layout); fixed for the life of the ctrl, like isFullWidth
  const showEmbeddedFullWidth = isFullWidth && rowCtrl.shouldCreateCellSections();

  // Flag used to avoid problematic initial-state reads on a dead / non-displayed row. Due to
  // async rendering it's possible for the row to be destroyed before Solid has rendered it.
  const isDisplayed = rowCtrl.rowNode.displayed;

  // CORE-JURISDICTION ATTRIBUTES ARE IMPERATIVE WRITES (per-row diet; same law as toggleCss /
  // CssClassManager): row-index, row-id, row-business-key, top, transform and the user row
  // styles each have exactly ONE writer — the ctrl, through the compProxy setter — and nothing
  // in this component derives from them. A signal + binding effect per attribute (React's
  // shape, where React owns the DOM) is pure overhead here: the setter writes the element,
  // exactly as vanilla's RowComp does. Seeded from the ctrl (Open question 7): the first
  // template render already carries index/top/transform, so there is no empty-row flash and
  // enter animations get their starting values — static initial attributes, then pushes.
  const initialRowIndex = isDisplayed ? rowCtrl.rowNode.getRowIndexString() : null;
  const initialRowId = rowCtrl.rowId;
  const initialBusinessKey = rowCtrl.businessKey;
  const initialTop = isDisplayed ? rowCtrl.getInitialRowTop() : undefined;
  const initialTransform = isDisplayed ? rowCtrl.getInitialTransform() : undefined;

  let domOrder = rowCtrl.getDomOrder();
  // one CellLane per pinned section, each seeded so bulk-add doesn't flash empty rows
  // (getInitialCellCtrls returns undefined when creation is deferred or not applicable)
  const lanes = [
    new CellLane(rowCtrl.getInitialCellCtrls(0)),
    new CellLane(rowCtrl.getInitialCellCtrls(1)),
    new CellLane(rowCtrl.getInitialCellCtrls(2)),
  ] as const;
  // React renders each lane as its own memo'd component over its own store, so a change to one
  // lane re-renders only that lane. Solid has no re-render to scope: each lane's <For> is its own
  // scope already, and an unchanged lane keeps its list identity (the ctrl never mutates a list it
  // gave; CellLane keeps the list it shows), so that lane's mapArray finds every cell in place
  // and keeps its mapped array — no DOM work. One signal carries the three lanes, which keeps the
  // per-row graph budget flat (test/unit/reactiveGraphBudget.test.tsx).
  const [laneCells, setLaneCells] = createSignal<LaneCells>([
    lanes[0].cells,
    lanes[1].cells,
    lanes[2].cells,
  ]);
  const notifyLanes = () => setLaneCells([lanes[0].cells, lanes[1].cells, lanes[2].cells]);

  // PINNED LANE WIDTHS ARE IMPERATIVE WRITES (the core-jurisdiction rule above): the ctrl is the
  // one writer (refreshPinnedSections) and nothing in our graph reads a width, so
  // refreshPinnedSections writes them as vanilla's RowComp does and a lane seeds its width from
  // the ctrl as it mounts. Which pinned lanes exist does have readers — the lane Show branches —
  // so that part is a signal, written only when it changes. The ctrl returns the same widths
  // object while the widths are unchanged, so an unchanged refresh is skipped by identity.
  let pinnedWidthsRef = rowCtrl.getMappedPinnedCellGroupWidths();
  const [pinnedWidths, setPinnedWidths] = createSignal(pinnedWidthsRef);

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

  const refreshPinnedSections = () => {
    const widths = rowCtrl.getMappedPinnedCellGroupWidths();
    const prev = pinnedWidthsRef;
    if (widths === prev) {
      return;
    }
    pinnedWidthsRef = widths;
    // a pinned section's width is on the element around its lane; a lane about to unmount takes
    // a harmless write, one about to mount reads its width as it is created
    eScrollingCells?.style.setProperty("width", `${widths.centerWidth}px`);
    ePinnedLeftCells?.parentElement?.style.setProperty("width", `${widths.leftWidth}px`);
    ePinnedRightCells?.parentElement?.style.setProperty("width", `${widths.rightWidth}px`);
    if (widths.renderLeft !== prev.renderLeft || widths.renderRight !== prev.renderRight) {
      setPinnedWidths(widths);
    }
  };

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
    // user row styles are additive, like vanilla (_addStylesToElement never removes keys)
    _addStylesToElement(eRef, rowCtrl.rowStyles);
    const setAttr = (name: string, value: string | null) => {
      if (value == null) {
        eRef.removeAttribute(name);
      } else {
        eRef.setAttribute(name, value);
      }
    };

    const compProxy: IRowComp = {
      // top/transform: initial values are static attributes of the first render (animation
      // starting point); every later value is a direct style write, like vanilla
      setTop: (value) => (eRef.style.top = value ?? ""),
      setTransform: (value) => (eRef.style.transform = value ?? ""),

      toggleCss: (name, on) => cssManager.toggleCss(name, on),

      // ensureDomOrder is documented as initial, yet rows follow a prop change; investigate
      // whether to make it truly initial, which would let this go with RowCtrl's listener
      // (AG-18759).
      setDomOrder: (value) => {
        const turnedOn = value && !domOrder;
        domOrder = value;
        if (!turnedOn) {
          return;
        }
        // an unchanged lane is not given again, so one shown unordered is put in order here
        let changed = lanes[0].order();
        changed = lanes[1].order() || changed;
        changed = lanes[2].order() || changed;
        if (changed) {
          notifyLanes();
        }
      },
      setRowIndex: (value) => setAttr("row-index", value),
      setRowId: (value) => setAttr("row-id", value),
      setRowBusinessKey: (value) => setAttr("row-business-key", value),
      setUserStyles: (styles) => _addStylesToElement(eRef, styles),
      // if we don't maintain the order, then cols will be ripped out of and into the dom when
      // cols are reordered, which would stop the CSS transitions from working
      setCellCtrls: (left, center, right, useFlushSync, colsVersion) => {
        let changed = lanes[0].take(left, colsVersion, domOrder);
        changed = lanes[1].take(center, colsVersion, domOrder) || changed;
        changed = lanes[2].take(right, colsVersion, domOrder) || changed;
        if (changed) {
          // the changed lanes go in one commit. React's store path skips flushSync
          // (useSyncExternalStore renders a store change synchronously by itself); Solid has
          // the one signal path, flushed when the ctrl asks
          agFlush(useFlushSync, notifyLanes);
        }
      },
      getPinnedLeftRowElement: () => ePinnedLeftCells,
      getScrollingRowElement: () => eScrollingCells,
      getPinnedRightRowElement: () => ePinnedRightCells,
      refreshPinnedSections,

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
        // one entry per slot, empty where a slot has none — the core skips those
        if (rowCtrl.isEmbeddedFullWidth) {
          return [
            fullWidthEmbeddedLeftComp,
            fullWidthEmbeddedCenterComp,
            fullWidthEmbeddedRightComp,
          ];
        }
        return fullWidthComp ? [fullWidthComp] : undefined;
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
    rowCtrl.setComp(compProxy, eRef, compBean);
  };

  onCleanup(() => {
    rowCtrl.unsetComp();
    compBean = context.destroyBean(compBean);
  });

  // FULL-WIDTH EFFECTS ARE CREATED ONLY FOR FULL-WIDTH ROWS (per-row diet). isFullWidth and
  // showEmbeddedFullWidth are fixed for the life of the ctrl (a change rebuilds the RowCtrl,
  // which remounts this comp via <For>), so gating computation CREATION on them is a static
  // branch, not a reactivity hazard — a normal cells row never creates the six effects below
  // (React runs all of them on every row and bails inside). Pinned by
  // test/unit/reactiveGraphBudget.test.tsx (per-row budget) and the groupDetailFullWidth
  // suites (full-width, embedded, detail autoHeight behavior unchanged).
  if (isFullWidth && !showEmbeddedFullWidth) {
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
  }

  if (showEmbeddedFullWidth) {
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
            // React re-renders here so the row re-reads the pinned lane widths; ours are direct
            // writes, refreshed the way the ctrl refreshes them
            refreshPinnedSections();
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
  }

  // the pinned/scrolling lanes render for normal cell rows AND embedded full-width rows; fixed
  // for the life of the ctrl, like isFullWidth (a lane given no cells yet renders empty)
  const showLanes = !isFullWidth || showEmbeddedFullWidth;

  // React asks editSvc.isEditing() once per lane render, so a grid with nothing in edit asks
  // nothing per cell on every lane re-render. <For> maps a cell only when it is created — a kept
  // cell is never asked again — and isEditing returns at once with nothing in edit, so there is
  // no per-render cost for that gate to save; the options object is shared, as upstream's is.
  const cellsJsx = (lane: 0 | 1 | 2) => (
    <For each={laneCells()[lane]}>
      {(cellCtrl) => (
        <CellComp
          cellCtrl={cellCtrl}
          context={context}
          editingCell={editSvc?.isEditing(cellCtrl, WITH_OPEN_EDITOR) ?? false}
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
      style={{ top: initialTop, transform: initialTransform }}
      row-index={initialRowIndex}
      row-id={initialRowId}
      row-business-key={initialBusinessKey}
    >
      {/* the lane getters must return undefined once a lane unmounts (React nulls refs on
          unmount; Solid refs don't re-run) — the core reads them for embedded full-width
          targets and pinned-section hit-testing, and a stale detached element would be used.
          Show function children give a scope to register the branch cleanups in. */}
      <Show when={showLanes}>
        {(_lanes) => {
          onCleanup(() => (eScrollingCells = undefined));
          // lane widths are seeded as each lane mounts; refreshPinnedSections writes the rest
          const { centerWidth } = rowCtrl.getMappedPinnedCellGroupWidths();
          return (
            <>
              <Show when={pinnedWidths().renderLeft}>
                {(_left) => {
                  onCleanup(() => (ePinnedLeftCells = undefined));
                  const { leftWidth } = rowCtrl.getMappedPinnedCellGroupWidths();
                  return (
                    <div
                      class="ag-grid-pinned-left-cells"
                      role="presentation"
                      style={{ width: `${leftWidth}px` }}
                    >
                      <div
                        class="ag-grid-container-wrapper"
                        role="presentation"
                        ref={(el) => (ePinnedLeftCells = el)}
                      >
                        {showEmbeddedFullWidth ? embeddedSectionJsx("left") : cellsJsx(0)}
                      </div>
                    </div>
                  );
                }}
              </Show>
              <div
                class="ag-grid-scrolling-cells"
                role="presentation"
                ref={(el) => (eScrollingCells = el)}
                style={{ width: `${centerWidth}px` }}
              >
                {showEmbeddedFullWidth ? embeddedSectionJsx("center") : cellsJsx(1)}
              </div>
              <Show when={pinnedWidths().renderRight}>
                {(_right) => {
                  onCleanup(() => (ePinnedRightCells = undefined));
                  const { rightWidth } = rowCtrl.getMappedPinnedCellGroupWidths();
                  return (
                    <div
                      class="ag-grid-pinned-right-cells"
                      role="presentation"
                      style={{ width: `${rightWidth}px` }}
                    >
                      <div
                        class="ag-grid-container-wrapper"
                        role="presentation"
                        ref={(el) => (ePinnedRightCells = el)}
                      >
                        {showEmbeddedFullWidth ? embeddedSectionJsx("right") : cellsJsx(2)}
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
        <div
          class="ag-full-width-anchor"
          role={fullWidthAnchorRole}
          ref={(el) => (eFullWidthAnchor = el)}
        >
          {fullWidthFrameworkJsx()}
        </div>
      </Show>
    </div>
  );
};

export default RowComp;

/**
 * One lane of a row's cells: the list the row last gave and the list shown. React's CellLane also
 * carries the lane's store (subscribe / pending / notify) for its per-lane components; here the
 * row's lane signal is the store (see notifyLanes in RowComp).
 */
class CellLane {
  /** The list the row last gave, and the columns version it was laid out at. */
  private given: CellCtrl[] | undefined = undefined;
  private colsVersion = -1;
  /** The list shown. */
  public cells: CellCtrl[] | undefined;

  public constructor(cells: CellCtrl[] | undefined) {
    this.cells = cells;
  }

  public take(next: CellCtrl[], colsVersion: number, domOrder: boolean): boolean {
    const given = this.given;
    if (next === given) {
      return false;
    }
    const prev = this.cells;
    // showing the row's own list, laid out at the same columns: `next` already keeps its cells
    // in order
    const cells =
      prev === given && colsVersion === this.colsVersion
        ? next
        : getNextValueIfDifferent(prev, next, domOrder, true);
    this.given = next;
    this.colsVersion = colsVersion;
    if (cells === prev) {
      return false;
    }
    this.cells = cells;
    return true;
  }

  /** Shows the list the row last gave, which keeps its cells in column order. */
  public order(): boolean {
    const given = this.given;
    if (given === undefined || this.cells === given) {
      return false;
    }
    this.cells = given;
    return true;
  }
}

const WITH_OPEN_EDITOR = { withOpenEditor: true };
