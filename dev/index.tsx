import { render } from "@solidjs/web";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";

import AgGridSolid from "../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

render(() => <AgGridSolid class="solid-grid" />, document.getElementById("solid-root")!);

createGrid(document.getElementById("vanilla-grid")!, {
  columnDefs: [
    { field: "make" },
    { field: "model" },
    { field: "price", filter: "agNumberColumnFilter" },
  ],
  rowData: [
    { make: "Toyota", model: "Celica", price: 35000 },
    { make: "Ford", model: "Mondeo", price: 32000 },
    { make: "Porsche", model: "Boxster", price: 72000 },
  ],
  defaultColDef: { sortable: true, resizable: true },
});
