import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createSignal } from "solid-js";

import type { Employee } from "../data";
import { makeEmployees, money } from "../data";

const columnDefs: ColDef<Employee>[] = [
  { field: "name", minWidth: 180 },
  { field: "dept", headerName: "Department" },
  { field: "country" },
  { field: "salary", filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value) },
  { field: "hireYear", headerName: "Hired", filter: "agNumberColumnFilter", maxWidth: 110 },
  { field: "rating", filter: "agNumberColumnFilter", maxWidth: 110 },
];

export const Basics = () => {
  const [quickFilter, setQuickFilter] = createSignal("");
  const [selectedCount, setSelectedCount] = createSignal(0);
  const rowData = makeEmployees(250);

  return (
    <>
      <div class="toolbar">
        <input
          class="text"
          type="text"
          placeholder="Quick filter (reactive quickFilterText prop)…"
          value={quickFilter()}
          onInput={(e) => setQuickFilter(e.currentTarget.value)}
          style={{ "min-width": "320px" }}
        />
        <span class="badge">{selectedCount()} selected</span>
      </div>
      <div class="grid-box">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{ flex: 1, sortable: true, filter: true, resizable: true }}
          rowSelection={{ mode: "multiRow" }}
          pagination={true}
          paginationPageSize={50}
          quickFilterText={quickFilter()}
          onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
        />
      </div>
      <p class="hint">
        Try: click headers to sort (shift-click for multi-sort), open the column menu to filter,
        drag column edges to resize, tick checkboxes or ctrl/shift-click rows to select.
      </p>
    </>
  );
};
