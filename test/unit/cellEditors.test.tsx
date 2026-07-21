// T3.8 jsdom coverage: API-driven editing flows through CellComp's editor paths (JS inline
// editor lifecycle, reactive Solid editor proxy, isCancelBeforeStart cancellation, stale-editor
// regression). Real user-interaction/keyboard/popup parity lives in the browser suite.
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import type { AgGridSolidRef, CustomCellEditorProps } from "../../src/index";
import AgGridSolid, { useGridCellEditor } from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
}

const rowData = (): CarRow[] => [
  { make: "Toyota", price: 35000 },
  { make: "Ford", price: 32000 },
];

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const mountSolid = (props: GridOptions<CarRow>) => {
  let apiRef: AgGridSolidRef<CarRow> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...props}
      ref={(r: AgGridSolidRef<CarRow>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<CarRow> | undefined };
};

const cellFor = (container: Element, rowIndex: number, colId: string) =>
  container.querySelector(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`);

describe("Cell editors (jsdom)", () => {
  it("JS inline editor (agTextCellEditor): startEditingCell mounts the editor gui in the cell, commit writes the value, editor is destroyed", async () => {
    const solid = mountSolid({
      columnDefs: [{ field: "make", editable: true }, { field: "price" }],
      rowData: rowData(),
    });
    await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
    const api = solid.api()!;

    api.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() => solid.container.querySelector(".ag-text-field-input") != null);

    const cell = cellFor(solid.container, 0, "make")!;
    const input = cell.querySelector<HTMLInputElement>(".ag-text-field-input")!;
    // editor gui mounted INSIDE the cell element (inline, not popup)
    expect(input).not.toBeNull();
    expect(input.value).toBe("Toyota");
    expect(cell.classList.contains("ag-cell-inline-editing")).toBe(true);
    expect(api.getCellEditorInstances()).toHaveLength(1);

    input.value = "Honda";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    api.stopEditing();
    await waitFor(() => cellFor(solid.container, 0, "make")?.textContent === "Honda");

    // editor torn down, editing classes reset
    expect(solid.container.querySelector(".ag-text-field-input")).toBeNull();
    const cellAfter = cellFor(solid.container, 0, "make")!;
    expect(cellAfter.classList.contains("ag-cell-inline-editing")).toBe(false);
    expect(cellAfter.classList.contains("ag-cell-not-inline-editing")).toBe(true);
    solid.unmount();
  });

  it("no stale editor: getCellEditorInstances() is empty immediately after stopEditing (before any flush)", async () => {
    const solid = mountSolid({
      columnDefs: [{ field: "make", editable: true }],
      rowData: rowData(),
    });
    await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
    const api = solid.api()!;

    api.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() => api.getCellEditorInstances().length === 1);

    api.stopEditing();
    // synchronous read — the React source notes the ref must clear before the render flush
    expect(api.getCellEditorInstances()).toHaveLength(0);
    solid.unmount();
  });

  it("reactive Solid inline editor: props.value/onValueChange flow through the proxy; getValue commits; props push without remount", async () => {
    const SolidEditor = (props: CustomCellEditorProps<CarRow, string>) => (
      <input
        class="unit-solid-editor"
        value={props.value ?? ""}
        onInput={(e) => props.onValueChange(e.currentTarget.value)}
      />
    );

    const solid = mountSolid({
      columnDefs: [{ field: "make", editable: true, cellEditor: SolidEditor }],
      rowData: rowData(),
    });
    await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
    const api = solid.api()!;

    api.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() => solid.container.querySelector(".unit-solid-editor") != null);

    const input = solid.container.querySelector<HTMLInputElement>(".unit-solid-editor")!;
    // initial value flowed from the edit params
    expect(input.value).toBe("Toyota");

    input.value = "Honda";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // onValueChange → proxy.updateValue is synchronous: the grid sees the value immediately
    expect(api.getCellEditorInstances()[0]!.getValue!()).toBe("Honda");
    // the version-bump props push updates the LIVE component (same element, no remount)
    await waitFor(
      () => solid.container.querySelector<HTMLInputElement>(".unit-solid-editor") != null,
    );
    expect(solid.container.querySelector(".unit-solid-editor")).toBe(input);

    api.stopEditing();
    await waitFor(() => cellFor(solid.container, 0, "make")?.textContent === "Honda");
    expect(solid.container.querySelector(".unit-solid-editor")).toBeNull();
    solid.unmount();
  });

  it("useGridCellEditor isCancelBeforeStart=true cancels editing before it starts", async () => {
    const CancellingEditor = (_props: CustomCellEditorProps<CarRow, string>) => {
      useGridCellEditor({ isCancelBeforeStart: () => true });
      return <input class="unit-cancelling-editor" />;
    };

    const solid = mountSolid({
      columnDefs: [{ field: "make", editable: true, cellEditor: CancellingEditor }],
      rowData: rowData(),
    });
    await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
    const api = solid.api()!;

    api.startEditingCell({ rowIndex: 0, colKey: "make" });
    // the cancellation runs on a deferred turn (setCellEditorRef setTimeout) — wait it out
    await waitFor(() => api.getEditingCells().length === 0);

    expect(solid.container.querySelector(".unit-cancelling-editor")).toBeNull();
    expect(cellFor(solid.container, 0, "make")?.textContent).toBe("Toyota");
    solid.unmount();
  });
});
