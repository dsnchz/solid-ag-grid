// T3.8 parity oracle: cell editing vs vanilla createGrid with identical colDefs — inline
// agTextCellEditor start/edit/commit/Escape-cancel, custom Solid editors through the
// CellEditorComponentProxy (reactiveCustomComponents default on), popup editor placement
// (PopupEditorWrapper + Portal), editing CSS classes and keyboard navigation semantics.
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions, ICellEditorComp, ICellEditorParams } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { onSettled } from "solid-js";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

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
  { make: "Porsche", price: 72000 },
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

const mountVanilla = (options: GridOptions<CarRow>) => {
  const container = document.createElement("div");
  container.style.height = "300px";
  container.style.width = "600px";
  document.body.appendChild(container);
  const api = createGrid(container, options);
  return {
    container,
    api,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
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

const cellFor = (root: Element, rowIndex: number, colId: string) =>
  root.querySelector<HTMLElement>(`.ag-row[row-index="${rowIndex}"] .ag-cell[col-id="${colId}"]`);

const gridsReady = async (solid: ReturnType<typeof mountSolid>, vanilla?: Element) => {
  await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
  if (vanilla) {
    await waitFor(() => cellFor(vanilla, 0, "make") != null);
  }
};

describe("Cell editors (browser)", () => {
  it("parity: agTextCellEditor inline — double-click starts editing with a focused editor, Enter commits, Escape cancels; CSS classes match vanilla", async () => {
    const defs: GridOptions<CarRow>["columnDefs"] = [
      { field: "make", editable: true },
      { field: "price" },
    ];
    const solid = mountSolid({ columnDefs: defs, rowData: rowData() });
    const vanilla = mountVanilla({ columnDefs: defs, rowData: rowData() });
    await gridsReady(solid, vanilla.container);

    const editFlow = async (root: Element, text: string, key: "{Enter}" | "{Escape}") => {
      await userEvent.dblClick(cellFor(root, 0, "make")!);
      await waitFor(() => root.querySelector(".ag-text-field-input") != null);
      const cell = cellFor(root, 0, "make")!;
      const input = cell.querySelector<HTMLInputElement>(".ag-text-field-input")!;
      // editor rendered inline and focused on open
      expect(document.activeElement).toBe(input);
      expect(cell.classList.contains("ag-cell-inline-editing")).toBe(true);
      expect(cell.classList.contains("ag-cell-not-inline-editing")).toBe(false);
      await userEvent.fill(input, text);
      await userEvent.keyboard(key);
      await waitFor(() => root.querySelector(".ag-text-field-input") == null);
      const cellAfter = cellFor(root, 0, "make")!;
      expect(cellAfter.classList.contains("ag-cell-inline-editing")).toBe(false);
      expect(cellAfter.classList.contains("ag-cell-not-inline-editing")).toBe(true);
      return cellAfter.textContent;
    };

    // Enter commits
    expect(await editFlow(solid.container, "Honda", "{Enter}")).toBe("Honda");
    expect(await editFlow(vanilla.container, "Honda", "{Enter}")).toBe("Honda");

    // Escape cancels (value stays as committed above)
    expect(await editFlow(solid.container, "IGNORED", "{Escape}")).toBe("Honda");
    expect(await editFlow(vanilla.container, "IGNORED", "{Escape}")).toBe("Honda");

    solid.unmount();
    vanilla.destroy();
  });

  it("parity: Tab while editing commits and moves editing to the next cell editor; api.startEditingCell/stopEditing match vanilla", async () => {
    const defs: GridOptions<CarRow>["columnDefs"] = [
      { field: "make", editable: true },
      { field: "price", editable: true },
    ];
    const solid = mountSolid({ columnDefs: defs, rowData: rowData() });
    const vanilla = mountVanilla({ columnDefs: defs, rowData: rowData() });
    await gridsReady(solid, vanilla.container);

    const tabFlow = async (root: Element, api: GridApi<CarRow>) => {
      api.startEditingCell({ rowIndex: 0, colKey: "make" });
      await waitFor(() => api.getEditingCells().length === 1);
      expect(api.getEditingCells()[0]!.colId).toBe("make");
      await waitFor(() => cellFor(root, 0, "make")!.querySelector("input") != null);

      await userEvent.keyboard("{Tab}");
      // editing session moved to the next cell, editor mounted there
      await waitFor(() => api.getEditingCells()[0]?.colId === "price");
      await waitFor(() => cellFor(root, 0, "price")!.querySelector("input") != null);

      api.stopEditing();
      expect(api.getCellEditorInstances()).toHaveLength(0);
      await waitFor(() => api.getEditingCells().length === 0);
    };

    await tabFlow(solid.container, solid.api()!);
    await tabFlow(vanilla.container, vanilla.api);

    solid.unmount();
    vanilla.destroy();
  });

  it("parity: custom Solid editor (useGridCellEditor) — value flows through onValueChange, commit writes through the proxy getValue, isCancelBeforeStart cancels with cell focused", async () => {
    const SolidEditor = (props: CustomCellEditorProps<CarRow, string>) => {
      // parity note: afterGuiAttached is NOT asserted — the React wrapper never invokes it on
      // the editor proxy for framework inline editors either (only JS editors get it)
      useGridCellEditor({
        isCancelBeforeStart: () => props.value === "Porsche",
      });
      let el!: HTMLInputElement;
      onSettled(() => {
        el.focus();
        el.select();
      });
      return (
        <input
          ref={el}
          class="solid-inline-editor"
          value={props.value ?? ""}
          onInput={(e) => props.onValueChange(e.currentTarget.value)}
        />
      );
    };

    // vanilla equivalent JS editor with the same cancel rule
    class VanillaEditor implements ICellEditorComp {
      private eInput = document.createElement("input");
      private params!: ICellEditorParams<CarRow, string>;
      init(params: ICellEditorParams<CarRow, string>) {
        this.params = params;
        this.eInput.className = "vanilla-inline-editor";
        this.eInput.value = params.value ?? "";
      }
      getGui() {
        return this.eInput;
      }
      afterGuiAttached() {
        this.eInput.focus();
        this.eInput.select();
      }
      isCancelBeforeStart() {
        return this.params.value === "Porsche";
      }
      getValue() {
        return this.eInput.value;
      }
    }

    const solid = mountSolid({
      columnDefs: [{ field: "make", editable: true, cellEditor: SolidEditor }],
      rowData: rowData(),
    });
    const vanilla = mountVanilla({
      columnDefs: [{ field: "make", editable: true, cellEditor: VanillaEditor }],
      rowData: rowData(),
    });
    await gridsReady(solid, vanilla.container);

    // --- value flow + Enter commit ---
    await userEvent.dblClick(cellFor(solid.container, 0, "make")!);
    await waitFor(() => solid.container.querySelector(".solid-inline-editor") != null);
    const input = solid.container.querySelector<HTMLInputElement>(".solid-inline-editor")!;
    expect(input.value).toBe("Toyota");
    expect(document.activeElement).toBe(input);
    await userEvent.fill(input, "Honda");
    // proxy value updated synchronously through onValueChange
    expect(solid.api()!.getCellEditorInstances()[0]!.getValue!()).toBe("Honda");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => cellFor(solid.container, 0, "make")?.textContent === "Honda");
    expect(solid.container.querySelector(".solid-inline-editor")).toBeNull();

    await userEvent.dblClick(cellFor(vanilla.container, 0, "make")!);
    await waitFor(() => vanilla.container.querySelector(".vanilla-inline-editor") != null);
    const vInput = vanilla.container.querySelector<HTMLInputElement>(".vanilla-inline-editor")!;
    await userEvent.fill(vInput, "Honda");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => cellFor(vanilla.container, 0, "make")?.textContent === "Honda");
    expect(cellFor(solid.container, 0, "make")?.textContent).toBe(
      cellFor(vanilla.container, 0, "make")?.textContent,
    );

    // --- isCancelBeforeStart true (row 2: Porsche) cancels editing, cell focused ---
    const cancelFlow = async (
      root: Element,
      api: GridApi<CarRow>,
      editorSelector: string,
    ): Promise<boolean> => {
      api.startEditingCell({ rowIndex: 2, colKey: "make" });
      await waitFor(() => api.getEditingCells().length === 0, 3000);
      await waitFor(() => root.querySelector(editorSelector) == null);
      const cell = cellFor(root, 2, "make")!;
      expect(cell.textContent).toBe("Porsche");
      return cell.contains(document.activeElement) || document.activeElement === cell;
    };
    expect(await cancelFlow(solid.container, solid.api()!, ".solid-inline-editor")).toBe(true);
    expect(await cancelFlow(vanilla.container, vanilla.api, ".vanilla-inline-editor")).toBe(true);

    solid.unmount();
    vanilla.destroy();
  });

  it("parity: JS popup editor (agLargeTextCellEditor) — popup positions over the cell, cell gets popup-editing classes, Escape closes and focus returns to the cell", async () => {
    const defs: GridOptions<CarRow>["columnDefs"] = [
      { field: "make", editable: true, cellEditor: "agLargeTextCellEditor", cellEditorPopup: true },
      { field: "price" },
    ];
    const solid = mountSolid({ columnDefs: defs, rowData: rowData() });
    const vanilla = mountVanilla({ columnDefs: defs, rowData: rowData() });
    await gridsReady(solid, vanilla.container);

    const popupFlow = async (root: Element, api: GridApi<CarRow>) => {
      api.startEditingCell({ rowIndex: 0, colKey: "make" });
      await waitFor(() => document.querySelector(".ag-popup-editor .ag-large-text") != null);
      const popup = document.querySelector<HTMLElement>(".ag-popup-editor")!;
      const cell = cellFor(root, 0, "make")!;

      // popup anchored over the cell (position: 'over' default)
      const popupRect = popup.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      expect(Math.abs(popupRect.left - cellRect.left)).toBeLessThan(10);
      expect(Math.abs(popupRect.top - cellRect.top)).toBeLessThan(30);

      // popup-editing classes on the cell; the underlying value stays rendered
      expect(cell.classList.contains("ag-cell-popup-editing")).toBe(true);
      expect(cell.classList.contains("ag-cell-inline-editing")).toBe(false);
      expect(cell.textContent).toContain("Toyota");

      // large-text textarea focused on open
      const textarea = popup.querySelector<HTMLTextAreaElement>("textarea")!;
      await waitFor(() => document.activeElement === textarea);

      await userEvent.keyboard("{Escape}");
      await waitFor(() => document.querySelector(".ag-popup-editor") == null);
      const cellAfter = cellFor(root, 0, "make")!;
      expect(cellAfter.classList.contains("ag-cell-popup-editing")).toBe(false);
      // focus restored to the cell
      await waitFor(
        () => cellAfter.contains(document.activeElement) || document.activeElement === cellAfter,
      );
      expect(cellAfter.textContent).toBe("Toyota");
    };

    await popupFlow(solid.container, solid.api()!);
    await popupFlow(vanilla.container, vanilla.api);

    solid.unmount();
    vanilla.destroy();
  });

  it("parity: custom Solid popup editor renders via Portal inside the PopupEditorWrapper; stopEditingWhenCellsLoseFocus modal behavior matches vanilla", async () => {
    const SolidPopupEditor = (props: CustomCellEditorProps<CarRow, string>) => {
      let el!: HTMLInputElement;
      onSettled(() => {
        el.focus();
      });
      return (
        <div class="solid-popup-editor">
          <input
            ref={el}
            class="solid-popup-editor-input"
            value={props.value ?? ""}
            onInput={(e) => props.onValueChange(e.currentTarget.value)}
          />
        </div>
      );
    };

    // price is the outside-click target below — sortable: false so the click doesn't sort
    // the grid and shuffle row 0 out from under the assertions
    const solid = mountSolid({
      columnDefs: [
        { field: "make", editable: true, cellEditor: SolidPopupEditor, cellEditorPopup: true },
        { field: "price", sortable: false },
      ],
      rowData: rowData(),
      stopEditingWhenCellsLoseFocus: true,
    });
    const vanilla = mountVanilla({
      columnDefs: [
        {
          field: "make",
          editable: true,
          cellEditor: "agLargeTextCellEditor",
          cellEditorPopup: true,
        },
        { field: "price", sortable: false },
      ],
      rowData: rowData(),
      stopEditingWhenCellsLoseFocus: true,
    });
    await gridsReady(solid, vanilla.container);

    // Solid editor content portals INTO the core PopupEditorWrapper gui
    solid.api()!.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() => document.querySelector(".ag-popup-editor .solid-popup-editor") != null);
    const popup = document.querySelector<HTMLElement>(".ag-popup-editor")!;
    const solidCell = cellFor(solid.container, 0, "make")!;
    const popupRect = popup.getBoundingClientRect();
    const cellRect = solidCell.getBoundingClientRect();
    expect(Math.abs(popupRect.left - cellRect.left)).toBeLessThan(10);
    expect(Math.abs(popupRect.top - cellRect.top)).toBeLessThan(30);
    expect(solidCell.classList.contains("ag-cell-popup-editing")).toBe(true);

    // edit then click outside the popup (the header — guaranteed not covered by the popup,
    // unlike lower rows under vanilla's large textarea) — modal + stopEditingWhenCellsLoseFocus
    // ends the edit session and commits
    const input = document.querySelector<HTMLInputElement>(".solid-popup-editor-input")!;
    await userEvent.fill(input, "Honda");
    // value reached the grid through the proxy before the session ends
    expect(solid.api()!.getCellEditorInstances()[0]!.getValue!()).toBe("Honda");
    await userEvent.click(solid.container.querySelector('.ag-header-cell[col-id="price"]')!);
    await waitFor(() => document.querySelector(".ag-popup-editor") == null);
    await waitFor(() => cellFor(solid.container, 0, "make")?.textContent === "Honda");
    expect(solid.api()!.getEditingCells()).toHaveLength(0);

    // vanilla: same interaction pattern ends the edit session the same way
    vanilla.api.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() => document.querySelector(".ag-popup-editor textarea") != null);
    await userEvent.fill(
      document.querySelector<HTMLTextAreaElement>(".ag-popup-editor textarea")!,
      "Honda",
    );
    await userEvent.click(vanilla.container.querySelector('.ag-header-cell[col-id="price"]')!);
    await waitFor(() => document.querySelector(".ag-popup-editor") == null);
    await waitFor(() => cellFor(vanilla.container, 0, "make")?.textContent === "Honda");
    expect(vanilla.api.getEditingCells()).toHaveLength(0);

    expect(cellFor(solid.container, 0, "make")?.textContent).toBe(
      cellFor(vanilla.container, 0, "make")?.textContent,
    );

    solid.unmount();
    vanilla.destroy();
  });
});
