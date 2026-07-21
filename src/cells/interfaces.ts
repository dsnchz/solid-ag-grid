import type { UserCompDetails } from "ag-grid-community";

import type { CellEditorComponentProxy } from "../customComp/cellEditorComponentProxy";

export interface RenderDetails {
  compDetails: UserCompDetails | undefined;
  value?: any;
  force?: boolean;
}

export interface EditDetails {
  compDetails: UserCompDetails;
  popup?: boolean;
  popupPosition?: "over" | "under";
  /** present when `componentFromFramework && reactiveCustomComponents` — the ICellEditor the
   * grid talks to while the user's Solid editor renders inline (not portal-based) */
  compProxy?: CellEditorComponentProxy;
}

export enum CellCompState {
  ShowValue,
  EditValue,
}
