import type {
  CustomFilterProps,
  CustomFloatingFilterProps,
  CustomHeaderProps,
  CustomLoadingOverlayProps,
  CustomNoRowsOverlayProps,
} from "@dschz/solid-ag-grid";
import { AgGridSolid, useGridFilter } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";

import type { Employee } from "../data";
import { DEPARTMENTS, makeEmployees, money } from "../data";

type DeptModel = string[] | null;

/** Column filter registered with useGridFilter — a checkbox list of departments.
 *  Solid components run once, so the hook registers exactly once; the grid pushes
 *  model changes into this live component (no remount). */
const DeptFilter = (props: CustomFilterProps<Employee, unknown, DeptModel>) => {
  useGridFilter({
    doesFilterPass: (params) => props.model == null || props.model.includes(params.data.dept),
  });

  const toggle = (dept: string, checked: boolean) => {
    const current = props.model ?? [];
    const next = checked ? [...current, dept] : current.filter((d) => d !== dept);
    props.onModelChange(next.length === 0 ? null : next);
  };

  return (
    <div class="custom-filter">
      <strong>Departments</strong>
      <For each={[...DEPARTMENTS]}>
        {(dept) => (
          <label>
            <input
              type="checkbox"
              checked={props.model?.includes(dept) ?? false}
              onChange={(e) => toggle(dept, e.currentTarget.checked)}
            />
            {dept}
          </label>
        )}
      </For>
      <button class="btn" onClick={() => props.onModelChange(null)}>
        clear
      </button>
    </div>
  );
};

/** Floating filter mirroring the parent filter's model — reads props.model live,
 *  writes back through props.onModelChange. */
const DeptFloatingFilter = (props: CustomFloatingFilterProps<any, Employee, unknown, DeptModel>) => (
  <div style={{ display: "flex", "align-items": "center", gap: "0.4rem", width: "100%" }}>
    <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
      {props.model == null ? "(all depts)" : props.model.join(", ")}
    </span>
    <Show when={props.model != null}>
      <button class="btn" style={{ padding: "0 0.4rem" }} onClick={() => props.onModelChange(null)}>
        ×
      </button>
    </Show>
  </div>
);

/** Custom header: click to cycle sort, live sort indicator via the column's own event. */
const SortHeader = (props: CustomHeaderProps<Employee>) => {
  // Pushed props must be read in tracked scopes (JSX/memos) — never in the component body.
  const [sortVersion, setSortVersion] = createSignal(0);
  const sort = createMemo(() => {
    sortVersion(); // re-read the column's sort whenever its sortChanged event fires
    return props.column.getSort() ?? null;
  });
  onSettled(() => {
    const column = untrack(() => props.column);
    const listener = () => setSortVersion((v) => v + 1);
    column.addEventListener("sortChanged", listener);
    // Solid 2.0: return the cleanup from onSettled (onCleanup is forbidden inside it).
    return () => column.removeEventListener("sortChanged", listener);
  });
  return (
    <span
      class="custom-header"
      onClick={(e) => props.enableSorting && props.progressSort(e.shiftKey)}
    >
      ★ {props.displayName}
      <span>{sort() === "asc" ? "▲" : sort() === "desc" ? "▼" : ""}</span>
    </span>
  );
};

const LoadingOverlay = (_props: CustomLoadingOverlayProps<Employee>) => (
  <div class="overlay-card">
    <strong>custom loading overlay</strong>
    <div>a plain Solid component, driven by the reactive loading prop</div>
  </div>
);

const NoRowsOverlay = (_props: CustomNoRowsOverlayProps<Employee>) => (
  <div class="overlay-card">
    <strong>custom no-rows overlay</strong>
    <div>restore the rows with the toolbar button above</div>
  </div>
);

const columnDefs: ColDef<Employee>[] = [
  { field: "name", headerComponent: SortHeader, minWidth: 180 },
  {
    field: "dept",
    headerName: "Department",
    filter: DeptFilter,
    floatingFilterComponent: DeptFloatingFilter,
  },
  { field: "country", filter: true },
  { field: "salary", filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value) },
];

const ALL_ROWS = makeEmployees(120, 7);

export const CustomComponents = () => {
  const [rows, setRows] = createSignal<Employee[]>(ALL_ROWS);
  const [loading, setLoading] = createSignal(false);

  const simulateLoading = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1800);
  };

  return (
    <>
      <div class="toolbar">
        <button class="btn" onClick={simulateLoading}>
          simulate loading (1.8s)
        </button>
        <Show
          when={rows().length > 0}
          fallback={
            <button class="btn primary" onClick={() => setRows(ALL_ROWS)}>
              restore rows
            </button>
          }
        >
          <button class="btn" onClick={() => setRows([])}>
            clear rows (no-rows overlay)
          </button>
        </Show>
      </div>
      <div class="grid-box">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rows()}
          loading={loading()}
          loadingOverlayComponent={LoadingOverlay}
          noRowsOverlayComponent={NoRowsOverlay}
          defaultColDef={{ flex: 1, floatingFilter: true }}
        />
      </div>
      <p class="hint">
        "name" has a custom header (click it — the ★ header cycles sort and tracks the sort state
        from the column's own event). "Department" has a checkbox filter registered with
        <code> useGridFilter</code> plus a floating filter that mirrors and clears the same model.
      </p>
    </>
  );
};
