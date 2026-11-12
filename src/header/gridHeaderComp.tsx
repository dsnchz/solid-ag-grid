import type { IGridHeaderComp } from "ag-grid-community";
import { GridHeaderCtrl } from "ag-grid-community";
import { CssClassManager } from "ag-stack";
import { createSignal, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import HeaderRowsComp from "./headerRowsComp";

type GridHeaderCompProps = {
  eGridViewport: HTMLElement;
};

const GridHeaderComp = (props: GridHeaderCompProps) => {
  const { context } = useContext(BeansContext);

  // signal-backed prop (GridBodyComp passes `gridViewportElement()`) consumed inside the ref
  // callback — capture once in the body (see the setComp verdict in gridComp.tsx)
  const eGridViewport = untrack(() => props.eGridViewport);

  let gridHeaderCtrl: GridHeaderCtrl | undefined;
  let eGui: HTMLDivElement | undefined;
  const [mounted, setMounted] = createSignal(false);

  const cssManager = new CssClassManager(() => eGui);

  const setHeaderRowFocusableElements = (elements: HTMLElement[]) => {
    gridHeaderCtrl?.setHeaderRowFocusableElements(elements);
  };

  const setRef = (eRef: HTMLDivElement) => {
    eGui = eRef;
    if (context.isDestroyed()) {
      return;
    }

    cssManager.toggleCss("ag-header", true);

    // header height is no longer pushed through the comp: GridHeaderCtrl sizes eGui and sets
    // --ag-internal-header-rows-height on the viewport itself
    const compProxy: IGridHeaderComp = {
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
    };

    gridHeaderCtrl = context.createBean(new GridHeaderCtrl());
    gridHeaderCtrl.setComp(compProxy, eRef, eGridViewport);
    setMounted(true);
  };

  onCleanup(() => {
    gridHeaderCtrl = context.destroyBean(gridHeaderCtrl);
  });

  return (
    <div ref={setRef} role="presentation">
      {mounted() ? (
        <HeaderRowsComp
          eGui={eGui!}
          eGridViewport={eGridViewport}
          setHeaderRowFocusableElements={setHeaderRowFocusableElements}
        />
      ) : null}
    </div>
  );
};

export default GridHeaderComp;
