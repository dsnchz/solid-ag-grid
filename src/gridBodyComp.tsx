import type { JSX } from "@solidjs/web";
import type {
  ComponentSelector,
  IGridBodyComp,
  VerticalSection,
  VerticalSectionMap,
} from "ag-grid-community";
import {
  _isCellSelectionEnabled,
  _isMultiRowSelection,
  FakeHScrollComp,
  FakeVScrollComp,
  GridBodyCtrl,
} from "ag-grid-community";
import {
  _setAriaColCount,
  _setAriaMultiSelectable,
  _setAriaRole,
  _setAriaRowCount,
  CssClassManager,
} from "ag-stack";
import { createMemo, createSignal, onSettled, useContext } from "solid-js";

import { BeansContext } from "./core/beansContext";
import { insertDomComment } from "./core/domComment";
import { classesList } from "./core/utils";
import GridHeaderComp from "./header/gridHeaderComp";
import RowContainerComp from "./rows/rowContainerComp";

type PinnedSectionState = { height: number; invisible: boolean };

const GridBodyComp = () => {
  const { context, gos, overlays, rangeSvc } = useContext(BeansContext);

  const [rowAnimationClass, setRowAnimationClass] = createSignal<string>("");
  const [pinnedSections, setPinnedSections] = createSignal<VerticalSectionMap<PinnedSectionState>>({
    top: { height: 0, invisible: true },
    bottom: { height: 0, invisible: true },
  });
  const [stickyBottomHeight, setStickyBottomHeight] = createSignal<string>("0px");
  const [stickyBottomWidth, setStickyBottomWidth] = createSignal<string>("100%");
  const [cellSelectableCss, setCellSelectableCss] = createSignal<string | null>(null);
  const [preventRowAnimationClass, setPreventRowAnimationClass] = createSignal<string | null>(null);

  // we initialise layoutClass to 'ag-layout-normal', because if we don't, the comp will initially
  // render with no width (as ag-layout-normal sets width to 0, which is needed for flex) which
  // gives the grid a massive width, which then renders a massive amount of columns. this problem
  // is due to Solid 2.0 rendering async (microtask batching), same as React — for the non-async
  // version (ie when not using a framework) this is not a problem as the UI will finish
  // initialising before we set data.
  const [layoutClass, setLayoutClass] = createSignal<string>("ag-layout-normal");

  let eRoot: HTMLDivElement | undefined;
  let eTop: HTMLDivElement | undefined;
  let eGridViewport: HTMLDivElement | undefined;
  let eGridScrollableArea: HTMLDivElement | undefined;
  let eBody: HTMLDivElement | undefined;
  let eBottom: HTMLDivElement | undefined;
  let eTopExtraRows: HTMLDivElement | undefined;

  // elements consumed by child comps (GridHeaderComp / RowContainerComp) are signals: the
  // children render only once these exist, mirroring the React wrapper's setState-backed refs
  const [topElement, setTopElement] = createSignal<HTMLDivElement>();
  const [gridViewportElement, setGridViewportElement] = createSignal<HTMLDivElement>();

  const cssManager = new CssClassManager(() => eRoot);

  const setPinnedSection = (section: VerticalSection, state: PinnedSectionState) => {
    setPinnedSections((prev) => {
      const current = prev[section];
      if (current.height === state.height && current.invisible === state.invisible) {
        return prev;
      }
      return { ...prev, [section]: state };
    });
  };

  // mount-once lifecycle (React: useEffect over [rootElement]): grid creation appended beans +
  // GridBodyCtrl need the elements document-connected, so this runs from onSettled rather than
  // the ref callbacks
  onSettled(() => {
    if (
      !eRoot ||
      context.isDestroyed() ||
      !eGridViewport ||
      !eBody ||
      !eTop ||
      !eBottom ||
      !eTopExtraRows
    ) {
      return;
    }

    const eRootEl = eRoot;
    const eGridViewportEl = eGridViewport;

    const beansToDestroy: any[] = [];
    const destroyFuncs: (() => void)[] = [];

    for (const [comment, el] of [
      [" AG Grid Body ", eRoot],
      [" AG Pinned Top ", eTop],
      [" AG Middle ", eGridViewport],
      [" AG Pinned Bottom ", eBottom],
    ] as const) {
      const removeComment = insertDomComment(comment, el);
      if (removeComment) {
        destroyFuncs.push(removeComment);
      }
    }

    const attachToDom = (eParent: HTMLElement, eChild: HTMLElement | Comment) => {
      eParent.appendChild(eChild);
      destroyFuncs.push(() => eChild.remove());
    };
    const newComp = (compClass: ComponentSelector["component"]) => {
      const comp = context.createBean(new compClass());
      beansToDestroy.push(comp);
      return comp;
    };
    const addComp = (
      eParent: HTMLElement,
      compClass: ComponentSelector["component"],
      comment: string,
    ) => {
      attachToDom(eParent, document.createComment(comment));
      attachToDom(eParent, newComp(compClass).getGui());
    };

    addComp(eRootEl, FakeHScrollComp, " AG Fake Horizontal Scroll ");
    addComp(eRootEl, FakeVScrollComp, " AG Fake Vertical Scroll ");
    const overlayComp = overlays?.getOverlayWrapperCompClass();
    if (overlayComp) {
      addComp(eRootEl, overlayComp, " AG Overlay Wrapper ");
    }

    const compProxy: IGridBodyComp = {
      setColumnCount: (count: number) => _setAriaColCount(eGridViewportEl, count),
      setRowCount: (count: number) => _setAriaRowCount(eGridViewportEl, count),
      setPinnedSection,
      setColumnMovingCss: (cssClass: string, flag: boolean) => cssManager.toggleCss(cssClass, flag),
      updateLayoutClasses: setLayoutClass,
      setCellSelectableCss: (cssClass: string | null, flag: boolean) =>
        setCellSelectableCss(flag ? cssClass : null),
      setRowAnimationCssOnScrollableArea: (animate: boolean) =>
        setRowAnimationClass(animate ? "ag-row-animation" : "ag-row-no-animation"),
      setPreventRowAnimationCssOnContainers: (prevent: boolean) =>
        setPreventRowAnimationClass(prevent ? "ag-prevent-animation" : null),
      setGridScrollableAreaWidth: (width: string) => {
        if (eGridScrollableArea) {
          eGridScrollableArea.style.width = width;
        }
      },
      setStickyBottomHeight,
      setStickyBottomWidth,
      setGridRole: (role: "grid" | "treegrid") => _setAriaRole(eGridViewportEl, role),
    };

    const ctrl = context.createBean(new GridBodyCtrl());
    beansToDestroy.push(ctrl);
    ctrl.setComp(compProxy, eRootEl, eGridViewportEl, eBody, eTop, eTopExtraRows, eBottom);

    if ((rangeSvc && _isCellSelectionEnabled(gos)) || _isMultiRowSelection(gos)) {
      _setAriaMultiSelectable(eGridViewportEl, true);
    }

    return () => {
      context.destroyBeans(beansToDestroy);
      for (const f of destroyFuncs) {
        f();
      }
    };
  });

  const rootClasses = createMemo(() => classesList("ag-root", "ag-unselectable", layoutClass()));
  const gridViewportClasses = createMemo(() => classesList("ag-grid-viewport", layoutClass()));
  const bodyClasses = createMemo(() =>
    classesList("ag-grid-scrolling-rows", layoutClass(), cellSelectableCss()),
  );
  const topClasses = createMemo(() => classesList("ag-grid-pinned-top-rows", cellSelectableCss()));
  const bottomSectionHidden = createMemo(() => {
    const stickyBottomHeightNumber = Number.parseFloat(stickyBottomHeight()) || 0;
    return pinnedSections().bottom.height <= 0 && stickyBottomHeightNumber <= 0;
  });

  const scrollableClasses = createMemo(() =>
    classesList(
      "ag-grid-scrollable-area",
      pinnedSections().top.invisible ? null : "ag-has-top-pinned-rows",
      pinnedSections().bottom.invisible ? null : "ag-has-bottom-pinned-rows",
    ),
  );
  const bottomClasses = createMemo(() =>
    classesList(
      "ag-grid-pinned-bottom-rows",
      bottomSectionHidden() ? "ag-hidden" : null,
      cellSelectableCss(),
    ),
  );
  const rowAnimationContainerClass = createMemo(() =>
    classesList(rowAnimationClass(), preventRowAnimationClass()),
  );

  const topStyle = createMemo<JSX.CSSProperties>(() => {
    const topRowsHeight = `${pinnedSections().top.height}px`;
    const topSectionHeight = `calc(var(--ag-header-rows-height, 0px) + ${topRowsHeight})`;
    return {
      "--ag-top-rows-height": topRowsHeight,
      "min-height": topSectionHeight,
      height: topSectionHeight,
    } as JSX.CSSProperties;
  });

  const bottomStyle = createMemo<JSX.CSSProperties>(
    () =>
      ({
        "--ag-bottom-rows-height": `${pinnedSections().bottom.height}px`,
        height: `calc(${pinnedSections().bottom.height}px + ${stickyBottomHeight()})`,
        "min-height": `calc(${pinnedSections().bottom.height}px + ${stickyBottomHeight()})`,
        width: stickyBottomWidth(),
      }) as JSX.CSSProperties,
  );

  return (
    <div ref={eRoot} class={rootClasses()} role="presentation">
      <div
        ref={(el) => {
          eGridViewport = el;
          setGridViewportElement(el);
        }}
        class={gridViewportClasses()}
        role="presentation"
      >
        <div ref={eGridScrollableArea} class={scrollableClasses()} role="rowgroup">
          <div
            ref={(el) => {
              eTop = el;
              setTopElement(el);
            }}
            class={topClasses()}
            role="presentation"
            style={topStyle()}
          >
            {topElement() && gridViewportElement() ? (
              <GridHeaderComp eTopSection={topElement()!} eGridViewport={gridViewportElement()!} />
            ) : null}
            <div ref={eTopExtraRows} class="ag-extra-rows-container" role="presentation" />
            {gridViewportElement() ? (
              <>
                <RowContainerComp
                  name="pinnedTop"
                  viewportElement={gridViewportElement()!}
                  extraClassName={rowAnimationContainerClass()}
                />
                <RowContainerComp name="stickyTop" viewportElement={gridViewportElement()!} />
              </>
            ) : null}
          </div>
          <div class={bodyClasses()} ref={eBody} role="presentation">
            {gridViewportElement() ? (
              <RowContainerComp
                name="scrolling"
                viewportElement={gridViewportElement()!}
                extraClassName={rowAnimationContainerClass()}
              />
            ) : null}
          </div>
          <div ref={eBottom} class={bottomClasses()} role="presentation" style={bottomStyle()}>
            {gridViewportElement() ? (
              <>
                <RowContainerComp name="stickyBottom" viewportElement={gridViewportElement()!} />
                <RowContainerComp
                  name="pinnedBottom"
                  viewportElement={gridViewportElement()!}
                  extraClassName={rowAnimationContainerClass()}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GridBodyComp;
