import type { HeaderRowCtrl, IHeaderRowsComp } from "ag-grid-community";
import { HeaderRowContainerCtrl } from "ag-grid-community";
import { createEffect, createSignal, For, onSettled, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import HeaderRowComp from "./headerRowComp";

interface HeaderRowsCompProps {
  eGui: HTMLElement;
  eGridViewport: HTMLElement;
  setHeaderRowFocusableElements?: (elements: HTMLElement[]) => void;
}

const HeaderRowsComp = (props: HeaderRowsCompProps) => {
  const { context } = useContext(BeansContext);

  // element props are stable for the life of the comp (GridHeaderComp remounts us if they ever
  // changed) — capture once in the body (see the setComp verdict in gridComp.tsx). The focusable-
  // elements callback is likewise a stable function prop consumed from untracked scopes.
  const eGui = untrack(() => props.eGui);
  const eGridViewport = untrack(() => props.eGridViewport);
  const setHeaderRowFocusableElements = untrack(() => props.setHeaderRowFocusableElements);

  const [headerRowCtrls, setHeaderRowCtrls] = createSignal<HeaderRowCtrl[]>([]);
  let headerRowContainerCtrl: HeaderRowContainerCtrl | undefined;
  const rowGuis = new Map<number, HTMLDivElement>();

  const setRowGui = (instanceId: number, el: HTMLDivElement | null) => {
    if (el) {
      rowGuis.set(instanceId, el);
    } else {
      rowGuis.delete(instanceId);
    }
  };

  // mount-once lifecycle: HeaderRowsComp renders a fragment (no root element of its own), so the
  // ctrl is created from onSettled rather than a ref callback; the parent elements it wires
  // against already exist. setComp pushes setCtrls synchronously — a legal signal write here
  // (onSettled runs outside any computation).
  onSettled(() => {
    if (context.isDestroyed()) {
      return;
    }

    const compProxy: IHeaderRowsComp = {
      setCtrls: (ctrls) => setHeaderRowCtrls(ctrls),
      setViewportScrollLeft: (_left) => {},
    };

    headerRowContainerCtrl = context.createBean(new HeaderRowContainerCtrl());
    headerRowContainerCtrl.setComp(compProxy, eGui, eGridViewport);

    return () => {
      setHeaderRowFocusableElements?.([]);
      headerRowContainerCtrl = context.destroyBean(headerRowContainerCtrl);
    };
  });

  // reactive → core push: keep GridHeaderCtrl's focusable-element list in sync with the rendered
  // header rows. Row guis are registered by HeaderRowComp refs during the render flush, before
  // user effects apply, so the map is complete when this runs (React: useLayoutEffect).
  createEffect(
    () => headerRowCtrls(),
    (ctrls) => {
      setHeaderRowFocusableElements?.(
        ctrls
          .map((ctrl) => rowGuis.get(ctrl.instanceId))
          .filter((el): el is HTMLDivElement => !!el),
      );
    },
  );

  return (
    <For each={headerRowCtrls()}>
      {(ctrl) => <HeaderRowComp ctrl={ctrl} setGuiRef={(el) => setRowGui(ctrl.instanceId, el)} />}
    </For>
  );
};

export default HeaderRowsComp;
