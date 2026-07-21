import type { UserCompDetails } from "ag-grid-community";

export interface RenderDetails {
  compDetails: UserCompDetails | undefined;
  value?: any;
  force?: boolean;
}

export interface EditDetails {
  compDetails: UserCompDetails;
  popup?: boolean;
  popupPosition?: "over" | "under";
  // T3.8: compProxy?: CellEditorComponentProxy (reactive custom editor integration)
}

export enum CellCompState {
  ShowValue,
  EditValue,
}
