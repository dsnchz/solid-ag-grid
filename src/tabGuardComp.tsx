import type { GridCtrl } from "ag-grid-community";
import { TabGuardCtrl } from "ag-grid-community";
import type { ITabGuard } from "ag-stack";
import { TabGuardClassNames } from "ag-stack";
import type { Element } from "solid-js";
import { onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "./core/beansContext";

export interface TabGuardRef {
  forceFocusOutOfContainer(up?: boolean): void;
}

interface TabGuardProps {
  children: Element;
  eFocusableElement: HTMLDivElement;
  forceFocusOutWhenTabGuardsAreEmpty?: boolean;
  gridCtrl: GridCtrl;
  onTabKeyDown: (e: KeyboardEvent) => void;
  isEmpty?: () => boolean;
  ref: (ref: TabGuardRef) => void;
}

const TabGuardComp = (props: TabGuardProps) => {
  const { context } = useContext(BeansContext);
  // signal-backed prop (GridComp passes `eGridBodyParent()`) consumed inside ref callbacks,
  // which run unowned mid-flush and would read the stale pre-flush value — capture it in the
  // component body instead (see the setComp note in gridComp.tsx)
  const eFocusableElement = untrack(() => props.eFocusableElement);

  let eTopGuard: HTMLDivElement | undefined;
  let eBottomGuard: HTMLDivElement | undefined;
  let tabGuardCtrl: TabGuardCtrl | undefined;

  // v36 sets the attribute imperatively on both guards without going through state; copy that —
  // no signal needed, and TabGuardCtrl.postConstruct may call this synchronously during setupCtrl.
  const setTabIndex = (value?: string | null) => {
    const processedValue = value == null ? undefined : parseInt(value, 10).toString();

    for (const tabGuard of [eTopGuard, eBottomGuard]) {
      if (processedValue === undefined) {
        tabGuard?.removeAttribute("tabindex");
      } else {
        tabGuard?.setAttribute("tabindex", processedValue);
      }
    }
  };

  // Runs from the guard-div ref callbacks (unowned scope — see the setComp note in gridComp.tsx);
  // creates the ctrl once both guards exist. The guards need not be document-connected:
  // TabGuardCtrl only attaches listeners and sets attributes on them.
  const setupCtrl = () => {
    if (!eTopGuard || !eBottomGuard || tabGuardCtrl || context.isDestroyed()) {
      return;
    }

    const compProxy: ITabGuard = {
      setTabIndex,
    };

    tabGuardCtrl = context.createBean(
      new TabGuardCtrl({
        comp: compProxy,
        eTopGuard,
        eBottomGuard,
        eFocusableElement,
        onTabKeyDown: (e) => props.onTabKeyDown(e),
        forceFocusOutWhenTabGuardsAreEmpty: props.forceFocusOutWhenTabGuardsAreEmpty,
        focusInnerElement: (fromBottom) => props.gridCtrl.focusInnerElement(fromBottom),
        isEmpty: props.isEmpty,
      }),
    );

    props.ref({
      forceFocusOutOfContainer(up?: boolean) {
        tabGuardCtrl?.forceFocusOutOfContainer(up);
      },
    });
  };

  onCleanup(() => {
    tabGuardCtrl = context.destroyBean(tabGuardCtrl);
  });

  const createTabGuard = (side: "top" | "bottom") => {
    const className =
      side === "top" ? TabGuardClassNames.TAB_GUARD_TOP : TabGuardClassNames.TAB_GUARD_BOTTOM;

    return (
      <div
        class={`${TabGuardClassNames.TAB_GUARD} ${className}`}
        role="presentation"
        ref={(e) => {
          if (side === "top") {
            eTopGuard = e;
          } else {
            eBottomGuard = e;
          }
          setupCtrl();
        }}
      />
    );
  };

  return (
    <>
      {createTabGuard("top")}
      {props.children}
      {createTabGuard("bottom")}
    </>
  );
};

export default TabGuardComp;
