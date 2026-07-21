import type { JSX } from "@solidjs/web";
import type { CellCtrl, IRowComp, RowContainerType, RowCtrl, RowStyle } from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { CssClassManager } from "ag-stack";
import { createMemo, createSignal, For, onCleanup, Show, untrack, useContext } from "solid-js";

import CellComp from "../cells/cellComp";
import { BeansContext } from "../core/beansContext";
import { agFlush, getNextValueIfDifferent } from "../core/utils";

interface RowCompProps {
  rowCtrl: RowCtrl;
  containerType: RowContainerType;
}

const RowComp = (props: RowCompProps) => {
  const { context, editSvc } = useContext(BeansContext);

  // raw <For> items / literals — stable identity, capture once in the body (setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const rowCtrl = untrack(() => props.rowCtrl);
  const containerType = untrack(() => props.containerType);

  const isFullWidth = rowCtrl.isFullWidth();

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

  let eGui: HTMLDivElement | undefined;
  let ePinnedLeftCells: HTMLDivElement | undefined;
  let eScrollingCells: HTMLDivElement | undefined;
  let ePinnedRightCells: HTMLDivElement | undefined;
  let compBean: _EmptyBean | undefined;

  // managing classes imperatively at the row level was too slow through React's render cycle;
  // the same reasoning holds here — toggleCss stays off the reactive graph
  const cssManager = new CssClassManager(() => eGui);

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

      // T3.10: full-width / embedded full-width / detail rows — safe no-ops until then
      showFullWidth: () => {},
      showEmbeddedFullWidth: () => {},
      getFullWidthCellRenderers: () => [],
      getFullWidthCellRendererParams: () => undefined,
      getFullWidthCellRendererParamsForPinned: () => undefined,
      refreshFullWidth: () => false,
      refreshEmbeddedFullWidth: () => false,
    };
    rowCtrl.setComp(compProxy, eRef, containerType, compBean);
  };

  onCleanup(() => {
    rowCtrl.unsetComp(containerType);
    compBean = context.destroyBean(compBean);
  });

  const rowStyles = createMemo(() => {
    const res: JSX.CSSProperties = { top: top(), transform: transform() };
    Object.assign(res, userStyles());
    return res;
  });

  const showCells = createMemo(() => !isFullWidth && cellCtrls() != null);

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
  // refreshPinnedSections bump and the cell set changing, so key the memo on both
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
      <Show when={showCells()}>
        {(_cells) => {
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
                        {cellsJsx(() => partitionedCellCtrls().left)}
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
                {cellsJsx(() => partitionedCellCtrls().center)}
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
                        {cellsJsx(() => partitionedCellCtrls().right)}
                      </div>
                    </div>
                  );
                }}
              </Show>
            </>
          );
        }}
      </Show>
      <Show when={isFullWidth}>
        {/* T3.10: full-width / embedded full-width renderers; markup branch present, empty */}
        <div class="ag-full-width-anchor" role="presentation" />
      </Show>
    </div>
  );
};

export default RowComp;
