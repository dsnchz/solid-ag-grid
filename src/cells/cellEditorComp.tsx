import type { JSX } from "@solidjs/web";
import type { CellCtrl, ICellEditor, ICellEditorComp } from "ag-grid-community";
import type { Accessor } from "solid-js";
import { Show } from "solid-js";

import { CustomContext } from "../customComp/customContext";
import type { CustomCellEditorCallbacks } from "../customComp/interfaces";
import type { EditDetails } from "./interfaces";
import PopupEditorComp from "./popupEditorComp";

const jsxEditorProxy = (
  editDetails: EditDetails,
  CellEditorClass: any,
  setRef: (cellEditor: ICellEditor | undefined) => void,
  editorParamsVersion: Accessor<number>,
) => {
  const { compProxy } = editDetails;
  setRef(compProxy);

  // RUN-ONCE DIVERGENCE vs React (documented per T3.7 warning): React re-renders CellComp on
  // every proxy refreshProps() call, so `compProxy.getProps()` is re-read per render. Solid
  // components run once — the version signal (bumped by the proxy's refreshProps) makes the
  // spread reactive instead, so onValueChange / editor.refresh(params) push new props into the
  // live editor component without a remount.
  const props = () => {
    editorParamsVersion();
    return compProxy!.getProps();
  };

  // isComponentStateless dropped (Solid comps are all functions); ref is a STATIC merge source
  // after the reactive spread (§7.8) — editors that never call props.ref simply leave the
  // proxy's getInstance() pending, matching React's stateless branch
  return (
    <CustomContext
      value={{
        setMethods: (methods: CustomCellEditorCallbacks) => compProxy!.setMethods(methods),
      }}
    >
      <CellEditorClass {...props()} ref={(ref: any) => compProxy!.setRef(ref)} />
    </CustomContext>
  );
};

const jsxEditor = (
  editDetails: EditDetails,
  CellEditorClass: any,
  setRef: (cellEditor: ICellEditor | undefined) => void,
  editorParamsVersion: Accessor<number>,
) => {
  const newFormat = editDetails.compProxy;

  return newFormat ? (
    jsxEditorProxy(editDetails, CellEditorClass, setRef, editorParamsVersion)
  ) : (
    <CellEditorClass {...editDetails.compDetails.params} ref={setRef} />
  );
};

export const jsxEditValue = (
  editDetails: EditDetails,
  setCellEditorRef: (cellEditor: ICellEditor | undefined) => void,
  eGui: HTMLElement,
  cellCtrl: CellCtrl,
  jsEditorComp: Accessor<ICellEditorComp | undefined>,
  editorParamsVersion: Accessor<number>,
): JSX.Element => {
  const compDetails = editDetails.compDetails;
  const CellEditorClass = compDetails.componentClass;

  const solidInlineEditor = compDetails.componentFromFramework && !editDetails.popup;
  const solidPopupEditor = compDetails.componentFromFramework && editDetails.popup;
  const jsPopupEditor = !compDetails.componentFromFramework && editDetails.popup;

  if (solidInlineEditor) {
    return jsxEditor(editDetails, CellEditorClass, setCellEditorRef, editorParamsVersion);
  }
  if (solidPopupEditor) {
    return (
      <PopupEditorComp
        editDetails={editDetails}
        cellCtrl={cellCtrl}
        eParentCell={eGui}
        wrappedContent={() =>
          jsxEditor(editDetails, CellEditorClass, setCellEditorRef, editorParamsVersion)
        }
      />
    );
  }
  if (jsPopupEditor) {
    // the JS editor instance arrives async (newAgStackInstance in CellComp's editor effect) —
    // React re-renders when its jsEditorComp state lands; Solid Shows on the signal instead
    return (
      <Show when={jsEditorComp()} keyed>
        {(comp) => (
          <PopupEditorComp
            editDetails={editDetails}
            cellCtrl={cellCtrl}
            eParentCell={eGui}
            jsChildComp={comp}
          />
        )}
      </Show>
    );
  }
  // JS inline editor: mounted imperatively by CellComp's editor effect — nothing to render
  return null;
};
