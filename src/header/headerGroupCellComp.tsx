import type {
  HeaderGroupCellCtrl,
  HeaderStyle,
  IHeaderGroupCellComp,
  IHeaderGroupComp,
  UserCompDetails,
} from "ag-grid-community";
import {
  _applyHeaderWrapperHidden,
  _applyHeaderWrapperMaxHeight,
  _EmptyBean,
} from "ag-grid-community";
import { _addStylesToElement, _setDisplayed, CssClassManager } from "ag-stack";
import { createEffect, createSignal, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";

type HeaderGroupCellCompProps = {
  readonly ctrl: HeaderGroupCellCtrl;
};

const HeaderGroupCellComp = (props: HeaderGroupCellCompProps) => {
  const { context } = useContext(BeansContext);

  // raw <For> item — stable identity, safe to read in refs (see the setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const ctrl = untrack(() => props.ctrl);

  const [ariaExpanded, setAriaExpanded] = createSignal<"true" | "false" | undefined>();
  const [userCompDetails, setUserCompDetails] = createSignal<UserCompDetails>();

  let compBean: _EmptyBean | undefined;
  let eGui: HTMLDivElement | undefined;
  let eResize: HTMLDivElement | undefined;
  let eHeaderCompWrapper: HTMLDivElement | undefined;
  let userComp: IHeaderGroupComp | undefined;

  // classes stay off the reactive graph (rowComp precedent) — and crucially, core features
  // write to eGui.classList directly (AgManagedFocusFeature adds ag-focus-managed during
  // setComp), which a wholesale reactive class binding would clobber
  const cssManager = new CssClassManager(() => eGui);

  // ctrl.setComp needs eResize/eHeaderCompWrapper, which are children of the root element and get
  // their refs applied later in the same template build — so the guarded setup runs from every
  // ref and fires once all three exist (order-independent; same pattern as TabGuardComp.setupCtrl)
  const setup = () => {
    if (!eGui || !eResize || !eHeaderCompWrapper || compBean) {
      return;
    }
    if (!ctrl.isAlive() || context.isDestroyed()) {
      return;
    }

    const eGuiEl = eGui;
    const eResizeEl = eResize;
    const eHeaderCompWrapperEl = eHeaderCompWrapper;
    compBean = context.createBean(new _EmptyBean());

    const compProxy: IHeaderGroupCellComp = {
      setWidth: (width: string) => {
        eGuiEl.style.width = width;
      },
      toggleCss: (name: string, on: boolean) => cssManager.toggleCss(name, on),
      // user headerStyle keys arrive camelCased — _addStylesToElement hyphenates and applies
      // via style.setProperty, exactly like the vanilla header comp (T3.3 normalizer flag)
      setUserStyles: (styles: HeaderStyle) => _addStylesToElement(eGuiEl, styles),
      setHeaderWrapperHidden: (hidden: boolean) =>
        _applyHeaderWrapperHidden(eHeaderCompWrapperEl, hidden),
      setHeaderWrapperMaxHeight: (value: number | null) =>
        _applyHeaderWrapperMaxHeight(eHeaderCompWrapperEl, value),
      setUserCompDetails: (compDetails: UserCompDetails) => setUserCompDetails(compDetails),
      // _setDisplayed for vanilla parity: aria-hidden is removed (not "false") when displayed
      setResizableDisplayed: (displayed: boolean) => _setDisplayed(eResizeEl, displayed),
      setAriaExpanded: (expanded: "true" | "false" | undefined) => setAriaExpanded(expanded),
      getUserCompInstance: () => userComp ?? undefined,
    };

    ctrl.setComp(compProxy, eGuiEl, eResizeEl, eHeaderCompWrapperEl, compBean);
  };

  onCleanup(() => {
    compBean = context.destroyBean(compBean);
  });

  // signal-keyed lifecycle of a non-Solid instance: mount/destroy the JS group header component
  // whenever the comp details change (React: useLayoutEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    (compDetails) =>
      showJsComp(compDetails, context, eHeaderCompWrapper!, (instance) => {
        userComp = instance;
      }),
  );

  // reactive → core push: (re)attach the drag source once the group header comp is in the DOM
  // (React: useEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    () => {
      ctrl.setDragSource(eGui!);
    },
  );

  // framework (Solid) group header comps render inline; the imperative handle arrives iff the
  // user component calls props.ref (no stateless/stateful split — all Solid comps are functions)
  const frameworkComp = () => {
    const compDetails = userCompDetails();
    if (!compDetails?.componentFromFramework) {
      return null;
    }
    const UserCompClass = compDetails.componentClass;
    return (
      <UserCompClass
        {...compDetails.params}
        ref={(instance: IHeaderGroupComp) => (userComp = instance)}
      />
    );
  };

  return (
    <div
      ref={(el) => {
        eGui = el;
        setup();
      }}
      class="ag-header-group-cell"
      role="columnheader"
      aria-expanded={ariaExpanded()}
    >
      <div
        ref={(el) => {
          eHeaderCompWrapper = el;
          setup();
        }}
        class="ag-header-cell-comp-wrapper"
        role="presentation"
      >
        {frameworkComp()}
      </div>
      <div
        ref={(el) => {
          eResize = el;
          setup();
        }}
        class="ag-header-cell-resize"
      />
    </div>
  );
};

export default HeaderGroupCellComp;
