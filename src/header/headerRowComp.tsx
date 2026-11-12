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
  _updatePinnedSectionWidths,
} from "ag-grid-community";
import { _addOrRemoveAttribute, _setAriaRowIndex } from "ag-stack";
import { createMemo, createSignal, For, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { agFlush, getNextValueIfDifferent } from "../core/utils";
import HeaderCellComp from "./headerCellComp";
import HeaderFilterCellComp from "./headerFilterCellComp";
import HeaderGroupCellComp from "./headerGroupCellComp";

/** The lane each header cell renders in, keyed by position, so a section change is told without building a key. */
interface CellSections {
  isPrint: boolean;
  ctrls: AbstractHeaderCellCtrl[];
  lanes: number[];
}

/** Records `ctrls` and their lanes, returning whether they differ from the last recorded ones. */
const updateCellSections = (
  sections: CellSections,
  ctrls: AbstractHeaderCellCtrl[],
  isPrint: boolean,
): boolean => {
  const lanes = sections.lanes;
  const len = ctrls.length;
  let changed = isPrint !== sections.isPrint || (!isPrint && len !== sections.ctrls.length);
  for (let i = 0; i < len && !isPrint; ++i) {
    const cellCtrl = ctrls[i]!;
    const lane = cellCtrl.column?.pinnedLane ?? 1;
    if (cellCtrl !== sections.ctrls[i] || lane !== lanes[i]) {
      changed = true;
    }
    lanes[i] = lane;
  }
  lanes.length = isPrint ? 0 : len;
  sections.isPrint = isPrint;
  sections.ctrls = ctrls;
  return changed;
};

/** A header cell with no column renders in the centre. */
const partitionByLane = (cellCtrls: AbstractHeaderCellCtrl[]) => {
  const byLane: [AbstractHeaderCellCtrl[], AbstractHeaderCellCtrl[], AbstractHeaderCellCtrl[]] = [
    [],
    [],
    [],
  ];
  for (let i = 0, len = cellCtrls.length; i < len; ++i) {
    const cellCtrl = cellCtrls[i]!;
    byLane[cellCtrl.column?.pinnedLane ?? 1].push(cellCtrl);
  }
  return { left: byLane[0], center: byLane[1], right: byLane[2] };
};

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
  const sections: CellSections = { isPrint: false, ctrls: [], lanes: [] };
  let domOrder = false;
  const [cellCtrls, setCellCtrls] = createSignal<AbstractHeaderCellCtrl[]>([]);
  // initial value is the creation-time read React makes in its useState initialiser; the ctrl
  // pushes later changes through setTabIndex
  const [tabIndex, setTabIndex] = createSignal<number | undefined>(
    _isHeaderFocusSuppressed(beans) ? undefined : gos.get("tabIndex"),
  );

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
    const next = updateCellSections(sections, cellCtrlsRef, isPrint)
      ? cellCtrlsRef
      : getNextValueIfDifferent(prevCellCtrlsRef, cellCtrlsRef, domOrder);

    if (next !== prevCellCtrlsRef) {
      prevCellCtrlsRef = next;
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
      setTabIndex,
      setAriaHidden: (hidden) => {
        _addOrRemoveAttribute(eGuiEl, "aria-hidden", hidden ? "true" : null);
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
    return partitionByLane(cellCtrls());
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

  return (
    <div
      ref={(el) => {
        eGui = el;
        setup();
      }}
      class={ctrl.headerRowClass}
      role="row"
      tabindex={tabIndex()}
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
