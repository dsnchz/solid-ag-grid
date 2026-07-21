import type {
  HeaderFilterCellCtrl,
  HeaderStyle,
  IFloatingFilter,
  IFloatingFilterParams,
  IHeaderFilterCellComp,
  UserCompDetails,
} from "ag-grid-community";
import { _EmptyBean, AgPromise } from "ag-grid-community";
import { _addStylesToElement, _setDisplayed, CssClassManager } from "ag-stack";
import { createEffect, createSignal, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";
import { CustomContext } from "../customComp/customContext";
import { FloatingFilterComponentProxy } from "../customComp/floatingFilterComponentProxy";
import { FloatingFilterDisplayComponentProxy } from "../customComp/floatingFilterDisplayComponentProxy";
import type { CustomFloatingFilterCallbacks } from "../customComp/interfaces";
import { warnReactiveCustomComponents } from "../customComp/util";

type HeaderFilterCellCompProps = {
  readonly ctrl: HeaderFilterCellCtrl;
};

type FloatingFilterProxy = FloatingFilterComponentProxy | FloatingFilterDisplayComponentProxy;

const HeaderFilterCellComp = (props: HeaderFilterCellCompProps) => {
  const { context, gos } = useContext(BeansContext);

  // raw <For> item — stable identity, safe to read in refs (see the setComp verdict in
  // gridComp.tsx); untrack silences the top-level-read dev warning
  const ctrl = untrack(() => props.ctrl);

  const [userCompDetails, setUserCompDetails] = createSignal<UserCompDetails | null>();
  // version signal bumped by the proxy's refreshProps — makes the props spread reactive so
  // model/params pushes update the live floating filter component without a remount (same
  // run-once divergence note as jsxEditorProxy in cellEditorComp.tsx)
  const [renderVersion, setRenderVersion] = createSignal(1);
  const [floatingFilterCompProxy, setFloatingFilterCompProxy] = createSignal<FloatingFilterProxy>();

  let compBean: _EmptyBean | undefined;
  let eGui: HTMLDivElement | undefined;
  let eFloatingFilterBody: HTMLDivElement | undefined;
  let eButtonWrapper: HTMLDivElement | undefined;
  let eButtonShowMainFilter: HTMLButtonElement | undefined;

  // classes stay off the reactive graph (rowComp precedent) — and crucially, core features
  // write to eGui.classList directly (AgManagedFocusFeature adds ag-focus-managed during
  // setComp), which a wholesale reactive class binding would clobber
  const cssManager = new CssClassManager(() => eGui);
  const bodyCssManager = new CssClassManager(() => eFloatingFilterBody);

  let userCompResolve: ((value: IFloatingFilter) => void) | undefined;
  let userCompPromise: AgPromise<IFloatingFilter> | undefined;

  const userCompRef = (value: IFloatingFilter | undefined) => {
    // We skip when it's un-setting
    if (value == null) {
      return;
    }

    userCompResolve?.(value);
  };

  // ctrl.setComp needs the body/button child elements, whose refs are applied later in the same
  // template build — so the guarded setup runs from every ref and fires once they all exist
  // (order-independent; same pattern as TabGuardComp.setupCtrl)
  const setup = () => {
    if (!eGui || !eFloatingFilterBody || !eButtonWrapper || !eButtonShowMainFilter || compBean) {
      return;
    }
    if (!ctrl.isAlive() || context.isDestroyed()) {
      return;
    }

    const eGuiEl = eGui;
    const eButtonWrapperEl = eButtonWrapper;
    const eButtonShowMainFilterEl = eButtonShowMainFilter;
    compBean = context.createBean(new _EmptyBean());

    userCompPromise = new AgPromise<IFloatingFilter>((resolve) => {
      userCompResolve = resolve;
    });

    const compProxy: IHeaderFilterCellComp = {
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
      // user headerStyle keys arrive camelCased — _addStylesToElement hyphenates and applies
      // via style.setProperty, exactly like the vanilla header comp (T3.3 normalizer flag)
      setUserStyles: (styles: HeaderStyle) => _addStylesToElement(eGuiEl, styles),
      addOrRemoveBodyCssClass: (name, on) => bodyCssManager.toggleCss(name, on),
      // _setDisplayed for vanilla parity: aria-hidden is removed (not "false") when displayed
      setButtonWrapperDisplayed: (displayed) => _setDisplayed(eButtonWrapperEl, displayed),
      setWidth: (width) => {
        eGuiEl.style.width = width;
      },
      setCompDetails: (compDetails) => setUserCompDetails(compDetails),
      getFloatingFilterComp: () => userCompPromise ?? null,
      setMenuIcon: (eIcon) => eButtonShowMainFilterEl.appendChild(eIcon),
    };

    ctrl.setComp(compProxy, eGuiEl, eButtonShowMainFilterEl, eFloatingFilterBody, compBean);
  };

  onCleanup(() => {
    compBean = context.destroyBean(compBean);
  });

  // signal-keyed lifecycle of a non-Solid instance: mount/destroy the JS floating filter
  // (all built-in floating filters) whenever the comp details change; its ref resolves the
  // ctrl's getFloatingFilterComp promise (React: useLayoutEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    (compDetails) => showJsComp(compDetails, context, eFloatingFilterBody!, userCompRef),
  );

  // reactiveCustomComponents/enableFilterHandlers are wrapper-creation-time reads in React too
  // (useMemo with [] deps) — plain body reads, not reactive
  const reactiveCustomComponents = gos.get("reactiveCustomComponents");
  const enableFilterHandlers = gos.get("enableFilterHandlers");

  // signal-keyed lifecycle of a non-Solid instance: the floating filter proxy adapts the grid's
  // IFloatingFilter interface for a framework comp rendered inline (no portal); resolving the
  // userCompPromise with the proxy routes onParentModelChanged/refresh through it
  // (React: useEffect over [userCompDetails])
  createEffect(
    () => userCompDetails(),
    (compDetails) => {
      if (compDetails?.componentFromFramework) {
        if (reactiveCustomComponents) {
          const proxy: FloatingFilterProxy = enableFilterHandlers
            ? new FloatingFilterDisplayComponentProxy(compDetails.params, () =>
                setRenderVersion((prev) => prev + 1),
              )
            : new FloatingFilterComponentProxy(compDetails.params as IFloatingFilterParams, () =>
                setRenderVersion((prev) => prev + 1),
              );
          userCompRef(proxy as IFloatingFilter);
          setFloatingFilterCompProxy(proxy);
        } else {
          warnReactiveCustomComponents();
        }
      }
    },
  );

  const jsxFloatingFilterProxy = (proxy: FloatingFilterProxy, UserCompClass: any) => {
    const proxyProps = () => {
      renderVersion();
      return proxy.getProps();
    };
    return (
      <CustomContext
        value={{
          setMethods: (methods: CustomFloatingFilterCallbacks) => proxy.setMethods(methods),
        }}
      >
        <UserCompClass {...proxyProps()} />
      </CustomContext>
    );
  };

  // framework (Solid) floating filters render inline: reactive branch through the proxy +
  // CustomContext; non-reactive branch renders with the raw grid params (deprecated, warned
  // above), where the comp's props.ref resolves the promise directly
  const frameworkComp = () => {
    const compDetails = userCompDetails();
    if (!compDetails?.componentFromFramework) {
      return null;
    }
    const UserCompClass = compDetails.componentClass;
    if (reactiveCustomComponents) {
      const proxy = floatingFilterCompProxy();
      if (!proxy) {
        return null;
      }
      return jsxFloatingFilterProxy(proxy, UserCompClass);
    }
    return (
      <UserCompClass
        {...compDetails.params}
        ref={(instance: IFloatingFilter) => userCompRef(instance)}
      />
    );
  };

  return (
    <div
      ref={(el) => {
        eGui = el;
        setup();
      }}
      class="ag-header-cell ag-floating-filter"
      role="gridcell"
    >
      <div
        ref={(el) => {
          eFloatingFilterBody = el;
          setup();
        }}
        role="presentation"
      >
        {frameworkComp()}
      </div>
      <div
        ref={(el) => {
          eButtonWrapper = el;
          setup();
        }}
        class="ag-floating-filter-button ag-hidden"
        role="presentation"
      >
        <button
          ref={(el) => {
            eButtonShowMainFilter = el;
            setup();
          }}
          type="button"
          class="ag-button ag-floating-filter-button-button"
          tabindex={-1}
        />
      </div>
    </div>
  );
};

export default HeaderFilterCellComp;
