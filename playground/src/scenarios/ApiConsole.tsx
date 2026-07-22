import type { AgGridSolidRef } from "@dschz/solid-ag-grid";
import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createSignal, For } from "solid-js";

import type { Employee } from "../data";
import { makeEmployees, money } from "../data";

const columnDefs: ColDef<Employee>[] = [
  { field: "name", minWidth: 170 },
  { field: "dept", headerName: "Department" },
  { field: "country" },
  { field: "salary", filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value) },
  { field: "hireYear", headerName: "Hired" },
];

export const ApiConsole = () => {
  let grid: AgGridSolidRef<Employee> | undefined;
  const [log, setLog] = createSignal<string[]>(["— grid api log —"]);
  let added = 0;

  const append = (line: string) =>
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`]);

  /** Every action goes through the ref-provided GridApi. */
  const withApi = (label: string, fn: (api: AgGridSolidRef<Employee>["api"]) => string | void) => {
    if (!grid) {
      append(`${label}: grid not ready yet`);
      return;
    }
    const result = fn(grid.api);
    append(result ? `${label}: ${result}` : label);
  };

  const actions: { label: string; run: () => void }[] = [
    {
      label: "selectAll()",
      run: () =>
        withApi(
          "selectAll",
          (api) => (api.selectAll(), `${api.getSelectedRows().length} rows selected`),
        ),
    },
    { label: "deselectAll()", run: () => withApi("deselectAll", (api) => api.deselectAll()) },
    {
      label: "getSelectedRows()",
      run: () =>
        withApi("getSelectedRows", (api) => {
          const rows = api.getSelectedRows();
          return `${rows.length} selected${rows.length ? ` — first: ${rows[0]?.name}` : ""}`;
        }),
    },
    {
      label: "sizeColumnsToFit()",
      run: () => withApi("sizeColumnsToFit", (api) => api.sizeColumnsToFit()),
    },
    {
      label: "autoSizeAllColumns()",
      run: () => withApi("autoSizeAllColumns", (api) => api.autoSizeAllColumns()),
    },
    {
      label: "setFilterModel({ dept: Engineering })",
      run: () =>
        withApi("setFilterModel", (api) => {
          api.setFilterModel({
            dept: { filterType: "text", type: "equals", filter: "Engineering" },
          });
          return `${api.getDisplayedRowCount()} rows displayed`;
        }),
    },
    {
      label: "setFilterModel(null)",
      run: () =>
        withApi("clear filters", (api) => {
          api.setFilterModel(null);
          return `${api.getDisplayedRowCount()} rows displayed`;
        }),
    },
    {
      label: "ensureIndexVisible(80)",
      run: () => withApi("ensureIndexVisible", (api) => api.ensureIndexVisible(80, "middle")),
    },
    {
      label: "applyTransaction({ add })",
      run: () =>
        withApi("applyTransaction", (api) => {
          added++;
          const res = api.applyTransaction({
            add: [
              {
                id: 10_000 + added,
                name: `New Hire ${added}`,
                dept: "Engineering",
                country: "USA",
                salary: 90000,
                hireYear: 2026,
                rating: 5,
              },
            ],
            addIndex: 0,
          });
          return `added ${res?.add.length ?? 0} row(s) at top`;
        }),
    },
    { label: "flashCells({})", run: () => withApi("flashCells", (api) => api.flashCells({})) },
    {
      label: "exportDataAsCsv()",
      run: () => withApi("exportDataAsCsv", (api) => (api.exportDataAsCsv(), "download triggered")),
    },
  ];

  return (
    <>
      <div class="toolbar">
        <For each={actions}>
          {(action) => (
            <button class="btn" onClick={action.run}>
              {action.label}
            </button>
          )}
        </For>
      </div>
      <div class="grid-box short">
        <AgGridSolid
          ref={(r) => {
            grid = r;
            append("ref received — GridApi ready");
          }}
          columnDefs={columnDefs}
          rowData={makeEmployees(100, 21)}
          rowSelection={{ mode: "multiRow" }}
          defaultColDef={{ flex: 1, sortable: true, filter: true }}
        />
      </div>
      <div class="log-panel">
        <For each={log()}>{(line) => <span class="log-line">{line}</span>}</For>
      </div>
    </>
  );
};
