import type { IGridHeaderComp } from "ag-grid-community";
import { GridHeaderCtrl } from "ag-grid-community";
import { CssClassManager } from "ag-stack";
import { createSignal, onCleanup, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import HeaderRowsComp from "./headerRowsComp";

type GridHeaderCompProps = {
  eTopSection: HTMLElement;
  eGridViewport: HTMLElement;
};

const GridHeaderComp = (props: GridHeaderCompProps) => {
  const { context, environment } = useContext(BeansContext);

  // signal-backed props (GridBodyComp passes `topElement()` / `gridViewportElement()`) consumed
  // inside the ref callback — capture once in the body (see the setComp verdict in gridComp.tsx)
  const eTopSection = untrack(() => props.eTopSection);
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

    const compProxy: IGridHeaderComp = {
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
      setHeightAndMinHeight: (height) => {
        const borderWidth = environment.getHeaderRowBorderWidth();
        const heightWithBorder = height + borderWidth;
        eTopSection.style.setProperty("--ag-header-rows-height", `${heightWithBorder}px`);
        eRef.style.height = `${heightWithBorder}px`;
      },
    };

    gridHeaderCtrl = context.createBean(new GridHeaderCtrl());
    gridHeaderCtrl.setComp(compProxy, eRef);
    setMounted(true);
  };

  onCleanup(() => {
    eTopSection.style.removeProperty("--ag-header-rows-height");
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
