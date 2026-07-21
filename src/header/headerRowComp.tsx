import type {
  AbstractHeaderCellCtrl,
  HeaderCellCtrl,
  HeaderFilterCellCtrl,
  HeaderGroupCellCtrl,
  HeaderRowCtrl,
  IHeaderRowComp,
  PinnedSectionWidthsCache,
} from "ag-grid-community";
import {
  _EmptyBean,
  _isHeaderFocusSuppressed,
  _partitionByPinned,
  _updatePinnedSectionWidths,
} from "ag-grid-community";
import { _setAriaRowIndex } from "ag-stack";
import { createMemo, createSignal, For, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { agFlush, getNextValueIfDifferent } from "../core/utils";
import HeaderCellComp from "./headerCellComp";
import HeaderFilterCellComp from "./headerFilterCellComp";
import HeaderGroupCellComp from "./headerGroupCellComp";

function getCellSectionSignature(ctrls: AbstractHeaderCellCtrl[], isPrint: boolean): string {
  if (isPrint) {
    return "print";
  }

  return ctrls
    .map((ctrl) => {
      const pinned = ctrl.column.getPinned() ?? "center";
      return `${ctrl.instanceId}:${pinned}`;
    })
    .join("|");
}

type HeaderRowCompProps = {
  ctrl: HeaderRowCtrl;
  setGuiRef?: (eGui: HTMLDivElement | null) => void;
};

const HeaderRowComp = (props: HeaderRowCompProps) => {
  const beans = useContext(BeansContext);
  const { context, visibleCols, gos } = beans;

  // raw <For> item — stable identity, safe to read in refs (see the setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const ctrl = untrack(() => props.ctrl);

  let eGui: HTMLDivElement | undefined;
  let ePinnedLeft: HTMLDivElement | undefined;
  let eScrolling: HTMLDivElement | undefined;
  let ePinnedRight: HTMLDivElement | undefined;
  let compBean: _EmptyBean | undefined;

  // Cell ctrls partitioned into 3 sections
  let cellCtrlsRef: AbstractHeaderCellCtrl[] = [];
  let prevCellCtrlsRef: AbstractHeaderCellCtrl[] = [];
  let sectionSignature = "";
  let domOrder = false;
  const [cellCtrls, setCellCtrls] = createSignal<AbstractHeaderCellCtrl[]>([]);

  const pinnedWidthsCache: PinnedSectionWidthsCache = {
    pinnedLeftWidth: undefined,
    centerWidth: undefined,
    pinnedRightWidth: undefined,
  };

  const refreshPinnedWidths = () => {
    if (!ePinnedLeft || !eScrolling || !ePinnedRight) {
      return;
    }
    const isPrint = gos.get("domLayout") === "print";
    _updatePinnedSectionWidths(
      visibleCols,
      isPrint,
      { ePinnedLeft, eScrolling, ePinnedRight },
      pinnedWidthsCache,
    );
  };

  const updateCellCtrls = (useFlush: boolean) => {
    const isPrint = gos.get("domLayout") === "print";
    const nextSectionSignature = getCellSectionSignature(cellCtrlsRef, isPrint);
    const shouldRefreshForSectionChange = sectionSignature !== nextSectionSignature;
    const next = shouldRefreshForSectionChange
      ? cellCtrlsRef
      : getNextValueIfDifferent(prevCellCtrlsRef, cellCtrlsRef, domOrder)!;

    if (next !== prevCellCtrlsRef) {
      prevCellCtrlsRef = next;
      sectionSignature = nextSectionSignature;
      agFlush(useFlush, () => setCellCtrls(next));
    }
  };

  // ctrl.setComp pushes the row width synchronously, which needs the pinned-lane elements — all
  // four elements live in one template, so the guarded setup runs from every ref and fires once
  // they all exist (order-independent; same pattern as TabGuardComp.setupCtrl)
  const setup = () => {
    if (!eGui || !ePinnedLeft || !eScrolling || !ePinnedRight || compBean) {
      return;
    }
    if (!ctrl.isAlive() || context.isDestroyed()) {
      return;
    }

    props.setGuiRef?.(eGui);
    compBean = context.createBean(new _EmptyBean());
    const eGuiEl = eGui;

    const compProxy: IHeaderRowComp = {
      setTop: (value) => {
        eGuiEl.style.top = value;
      },
      setHeight: (value) => {
        eGuiEl.style.height = value;
      },
      setHeaderCtrls: (ctrls, forceOrder, afterScroll) => {
        domOrder = forceOrder;
        cellCtrlsRef = ctrls;
        updateCellCtrls(afterScroll);
      },
      refreshPinnedCellGroupWidths: () => refreshPinnedWidths(),
      setWidth: (value) => {
        eGuiEl.style.width = value;
      },
      setRowIndex: (rowIndex) => {
        _setAriaRowIndex(eGuiEl, rowIndex);
        eGuiEl.classList.toggle("ag-header-row-not-first", rowIndex !== 1);
      },
    };

    ctrl.setComp(compProxy, compBean);
  };

  onCleanup(() => {
    props.setGuiRef?.(null);
    compBean = context.destroyBean(compBean);
  });

  // print layout is applied via full grid refresh (domLayout property listener recreates header
  // rows), so a body-time read matches the React wrapper's render-time gos.get
  const isPrint = gos.get("domLayout") === "print";
  const partitioned = createMemo(() => {
    if (isPrint) {
      return {
        left: [] as AbstractHeaderCellCtrl[],
        center: cellCtrls(),
        right: [] as AbstractHeaderCellCtrl[],
      };
    }
    return _partitionByPinned(cellCtrls(), (cellCtrl: AbstractHeaderCellCtrl) =>
      cellCtrl.column.getPinned(),
    );
  });

  const createCellJsx = (cellCtrl: AbstractHeaderCellCtrl) => {
    switch (ctrl.type) {
      case "group":
        return <HeaderGroupCellComp ctrl={cellCtrl as HeaderGroupCellCtrl} />;
      case "filter":
        return <HeaderFilterCellComp ctrl={cellCtrl as HeaderFilterCellCtrl} />;
      default:
        return <HeaderCellComp ctrl={cellCtrl as HeaderCellCtrl} />;
    }
  };

  const tabIndex = _isHeaderFocusSuppressed(beans) ? undefined : gos.get("tabIndex");

  return (
    <div
      ref={(el) => {
        eGui = el;
        setup();
      }}
      class={ctrl.headerRowClass}
      role="row"
      tabindex={tabIndex}
    >
      <div
        ref={(el) => {
          ePinnedLeft = el;
          setup();
        }}
        class="ag-grid-pinned-left-cells"
        role="presentation"
      >
        <div class="ag-grid-container-wrapper" role="presentation">
          <For each={partitioned().left}>{createCellJsx}</For>
        </div>
      </div>
      <div
        ref={(el) => {
          eScrolling = el;
          setup();
        }}
        class="ag-grid-scrolling-cells"
        role="presentation"
      >
        <For each={partitioned().center}>{createCellJsx}</For>
      </div>
      <div
        ref={(el) => {
          ePinnedRight = el;
          setup();
        }}
        class="ag-grid-pinned-right-cells"
        role="presentation"
      >
        <div class="ag-grid-container-wrapper" role="presentation">
          <For each={partitioned().right}>{createCellJsx}</For>
        </div>
      </div>
    </div>
  );
};

export default HeaderRowComp;
