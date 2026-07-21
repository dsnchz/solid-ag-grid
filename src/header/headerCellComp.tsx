import type {
  HeaderCellCtrl,
  HeaderStyle,
  IHeader,
  IHeaderCellComp,
  UserCompDetails,
} from "ag-grid-community";
import { _EmptyBean } from "ag-grid-community";
import { _removeAriaSort, _setAriaSort, CssClassManager } from "ag-stack";
import { createEffect, createSignal, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";

interface HeaderCellCompProps {
  ctrl: HeaderCellCtrl;
}

const HeaderCellComp = (props: HeaderCellCompProps) => {
  const { context } = useContext(BeansContext);

  // raw <For> item — stable identity, safe to read in refs (see the setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const ctrl = untrack(() => props.ctrl);

  const [userCompDetails, setUserCompDetails] = createSignal<UserCompDetails>();
  const [userStyles, setUserStyles] = createSignal<HeaderStyle>();

  let compBean: _EmptyBean | undefined;
  let eGui: HTMLDivElement | undefined;
  let eResize: HTMLDivElement | undefined;
  let eHeaderCompWrapper: HTMLDivElement | undefined;
  let userComp: IHeader | undefined;

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
    compBean = context.createBean(new _EmptyBean());

    const refreshSelectAllGui = () => {
      const selectAllGui = ctrl.getSelectAllGui();
      if (selectAllGui) {
        eResizeEl.insertAdjacentElement("afterend", selectAllGui);
        compBean!.addDestroyFunc(() => selectAllGui.remove());
      }
    };

    const compProxy: IHeaderCellComp = {
      setWidth: (width: string) => {
        eGuiEl.style.width = width;
      },
      toggleCss: (name: string, on: boolean) => cssManager.toggleCss(name, on),
      setUserStyles: (styles: HeaderStyle) => setUserStyles(styles),
      setAriaSort: (sort) => {
        if (sort) {
          _setAriaSort(eGuiEl, sort);
        } else {
          _removeAriaSort(eGuiEl);
        }
      },
      setUserCompDetails: (compDetails: UserCompDetails) => setUserCompDetails(compDetails),
      getUserCompInstance: () => userComp ?? undefined,
      refreshSelectAllGui,
      removeSelectAllGui: () => ctrl.getSelectAllGui()?.remove(),
    };

    ctrl.setComp(compProxy, eGuiEl, eResizeEl, eHeaderCompWrapper, compBean);

    refreshSelectAllGui();
  };

  onCleanup(() => {
    compBean = context.destroyBean(compBean);
  });

  // signal-keyed lifecycle of a non-Solid instance: mount/destroy the JS header component
  // whenever the comp details change (React: useLayoutEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    (compDetails) =>
      showJsComp(compDetails, context, eHeaderCompWrapper!, (instance) => {
        userComp = instance;
      }),
  );

  // reactive → core push: (re)attach the drag source once the header comp is in the DOM
  // (React: useEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    () => {
      ctrl.setDragSource(eGui);
    },
  );

  // framework (Solid) header comps render inline; the imperative handle arrives iff the user
  // component calls props.ref (no stateless/stateful split — all Solid comps are functions)
  const frameworkComp = () => {
    const compDetails = userCompDetails();
    if (!compDetails?.componentFromFramework) {
      return null;
    }
    const UserCompClass = compDetails.componentClass;
    return (
      <UserCompClass {...compDetails.params} ref={(instance: IHeader) => (userComp = instance)} />
    );
  };

  return (
    <div
      ref={(el) => {
        eGui = el;
        setup();
      }}
      style={userStyles()}
      class="ag-header-cell"
      role="columnheader"
    >
      <div
        ref={(el) => {
          eResize = el;
          setup();
        }}
        class="ag-header-cell-resize"
        role="presentation"
      />
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
    </div>
  );
};

export default HeaderCellComp;
