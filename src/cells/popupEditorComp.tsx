import type { JSX } from "@solidjs/web";
import { Portal } from "@solidjs/web";
import type { CellCtrl, ICellEditorComp, PopupEditorWrapper } from "ag-grid-community";
import { _getActiveDomElement } from "ag-stack";
import { createSignal, onSettled, Show, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import type { EditDetails } from "./interfaces";

type PopupEditorCompProps = {
  readonly editDetails: EditDetails;
  readonly cellCtrl: CellCtrl;
  readonly eParentCell: HTMLElement;
  /** framework editor content, deferred as a function so the editor component is only
   * constructed once the popup wrapper gui exists (React defers via createPortal-when-state) */
  readonly wrappedContent?: () => JSX.Element;
  /** already-created JS editor instance — its gui is appended into the popup wrapper */
  readonly jsChildComp?: ICellEditorComp;
};

/**
 * Port of React's PopupEditorComp: creates the core PopupEditorWrapper bean, registers it as a
 * popup via popupSvc.addPopup (positioned over the parent cell), and portals framework editor
 * content into the wrapper's gui. React's useEffectOnce is StrictMode-only ceremony — plain
 * `onSettled` here (Solid effects run once).
 */
const PopupEditorComp = (props: PopupEditorCompProps) => {
  const beans = useContext(BeansContext);
  const { context, popupSvc, gos, editSvc } = beans;

  // props are plain per-edit-session values handed over by jsxEditValue (never signal-backed);
  // capture once in the body per the §7.1 read convention
  const editDetails = untrack(() => props.editDetails);
  const cellCtrl = untrack(() => props.cellCtrl);
  const eParentCell = untrack(() => props.eParentCell);
  const jsChildComp = untrack(() => props.jsChildComp);
  const wrappedContent = untrack(() => props.wrappedContent);

  const [popupEditorWrapper, setPopupEditorWrapper] = createSignal<PopupEditorWrapper>();

  // Effect classification (§5.1 bridge category 2): mount-once lifecycle of non-Solid
  // instances — the PopupEditorWrapper bean and its popupSvc registration. No async props are
  // read here, so no idempotence guard is needed (§7.9).
  onSettled(() => {
    if (context.isDestroyed()) {
      return;
    }

    const { compDetails } = editDetails;
    const useModelPopup = gos.get("stopEditingWhenCellsLoseFocus");

    const wrapper = context.createBean(editSvc!.createPopupEditorWrapper(compDetails.params!));
    const ePopupGui = wrapper.getGui();

    if (jsChildComp) {
      const eChildGui = jsChildComp.getGui();
      if (eChildGui) {
        ePopupGui.appendChild(eChildGui);
      }
    }

    const { column, rowNode } = cellCtrl;
    const positionParams = {
      column,
      rowNode,
      type: "popupCellEditor",
      eventSource: eParentCell,
      ePopup: ePopupGui,
      position: editDetails.popupPosition,
      keepWithinBounds: true,
    };

    const positionCallback = popupSvc?.positionPopupByComponent.bind(popupSvc, positionParams);

    const addPopupRes = popupSvc?.addPopup({
      modal: useModelPopup,
      eChild: ePopupGui,
      closeOnEsc: true,
      closedCallback: (e?: MouseEvent | TouchEvent | KeyboardEvent) => {
        cellCtrl.onPopupEditorClosed(e);
      },
      anchorToElement: eParentCell,
      positionCallback,
      ariaOwns: eParentCell,
    });

    const hideEditorPopup = addPopupRes?.hideFunc;

    setPopupEditorWrapper(wrapper);

    jsChildComp?.afterGuiAttached?.();

    return () => {
      // focus restore first (React runs its useLayoutEffect cleanup before the mount-effect
      // cleanup): if the popup held focus and the cell is still the focused cell, move focus
      // back to the parent cell before the popup gui is hidden/destroyed
      if (cellCtrl.isCellFocused() && ePopupGui.contains(_getActiveDomElement(beans))) {
        eParentCell.focus({ preventScroll: true });
      }
      hideEditorPopup?.();
      context.destroyBean(wrapper);
    };
  });

  return (
    <Show when={wrappedContent && popupEditorWrapper()} keyed>
      {(wrapper) => <Portal mount={wrapper.getGui()}>{wrappedContent!()}</Portal>}
    </Show>
  );
};

export default PopupEditorComp;
