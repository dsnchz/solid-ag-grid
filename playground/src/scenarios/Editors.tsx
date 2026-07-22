import type { CustomCellEditorProps } from "@dschz/solid-ag-grid";
import { AgGridSolid, useGridCellEditor } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createSignal, For, onSettled, Show } from "solid-js";

import type { Employee } from "../data";
import { DEPARTMENTS, makeEmployees, money } from "../data";

const isValidName = (v: string | null | undefined) => (v ?? "").trim().length >= 2;

/** Inline custom editor with live validation. Invalid values are rejected on commit
 *  via isCancelAfterEnd; editing Finance rows never starts (isCancelBeforeStart). */
const NameEditor = (props: CustomCellEditorProps<Employee, string>) => {
  useGridCellEditor({
    isCancelBeforeStart: () => props.data.dept === "Finance",
    isCancelAfterEnd: () => !isValidName(props.value),
  });
  let el!: HTMLInputElement;
  onSettled(() => {
    el.focus();
    el.select();
  });
  return (
    <input
      ref={el}
      class={isValidName(props.value) ? "editor-input" : "editor-input invalid"}
      value={props.value ?? ""}
      onInput={(e) => props.onValueChange(e.currentTarget.value)}
    />
  );
};

/** Popup custom editor: a department picker. Selecting commits and closes. */
const DeptEditor = (props: CustomCellEditorProps<Employee, string>) => (
  <div class="popup-editor">
    <For each={[...DEPARTMENTS]}>
      {(dept) => (
        <button
          class={props.value === dept ? "btn active" : "btn"}
          onClick={() => {
            props.onValueChange(dept);
            props.stopEditing();
          }}
        >
          {dept}
        </button>
      )}
    </For>
  </div>
);

const columnDefs: ColDef<Employee>[] = [
  { field: "name", editable: true, cellEditor: NameEditor, minWidth: 180 },
  {
    field: "dept",
    headerName: "Department",
    editable: true,
    cellEditor: DeptEditor,
    cellEditorPopup: true,
  },
  {
    field: "salary",
    editable: true,
    cellEditor: "agNumberCellEditor",
    cellEditorParams: { min: 0, max: 1_000_000 },
    valueFormatter: (p) => money(p.value),
  },
  { field: "country" },
];

export const Editors = () => {
  const [lastEdit, setLastEdit] = createSignal<string | null>(null);
  const rowData = makeEmployees(40, 11);

  return (
    <>
      <div class="toolbar">
        <Show when={lastEdit()} fallback={<span class="badge">no edits yet</span>}>
          <span class="badge live">last edit: {lastEdit()}</span>
        </Show>
      </div>
      <div class="grid-box short">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={{ flex: 1 }}
          onCellValueChanged={(e) =>
            setLastEdit(`${e.colDef.field} → ${String(e.newValue)} (${e.data.name})`)
          }
        />
      </div>
      <p class="hint">
        Double-click "name" for the inline Solid editor — clearing it below 2 characters turns the
        border red and the commit is cancelled (<code>isCancelAfterEnd</code>). Names of Finance
        employees refuse to start editing at all (<code>isCancelBeforeStart</code>). "Department"
        opens a popup picker (<code>cellEditorPopup</code>), "salary" uses the built-in
        <code> agNumberCellEditor</code>.
      </p>
    </>
  );
};
