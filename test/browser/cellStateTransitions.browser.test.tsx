// Per-cell state seams the diet relocates (editing classes, tool widgets) pinned as behavior:
// 1. editing CSS classes match vanilla at MOUNT and across every transition (inline start/stop,
//    popup start/stop) — the classes become event-driven writes instead of an effect;
// 2. tool widgets (selection checkboxes) are created, destroyed and re-created as the cell
//    wrapper toggles with rowSelection — their lifecycle moves into the wrapper's scope.
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type CarRow = { make: string; notes: string };
const rowData = (): CarRow[] => [
  { make: "Toyota", notes: "a" },
  { make: "Ford", notes: "b" },
  { make: "Porsche", notes: "c" },
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
  container.style.cssText = "height:300px;width:600px";
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
const EDIT_CLASSES = /^ag-cell-(value|inline-editing|popup-editing|not-inline-editing|wrapper)$/;
const editClasses = (cell: Element | null) =>
  Array.from(cell?.classList ?? [])
    .filter((c) => EDIT_CLASSES.test(c))
    .sort();

describe("cell state transitions (browser)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("editing CSS classes match vanilla at mount and across inline/popup start+stop", async () => {
    const options: GridOptions<CarRow> = {
      columnDefs: [
        { field: "make", editable: true },
        {
          field: "notes",
          editable: true,
          cellEditor: "agLargeTextCellEditor",
          cellEditorPopup: true,
        },
      ],
      rowData: rowData(),
    };
    const vanilla = mountVanilla(options);
    const solid = mountSolid(options);
    await waitFor(() => solid.api() != null && cellFor(solid.container, 0, "make") != null);
    await waitFor(() => cellFor(vanilla.container, 0, "make") != null);

    const snapshot = (colId: string) => ({
      solid: editClasses(cellFor(solid.container, 0, colId)),
      vanilla: editClasses(cellFor(vanilla.container, 0, colId)),
    });
    // 0. mount
    let s = snapshot("make");
    expect(s.solid).toEqual(s.vanilla);
    expect(s.solid).toContain("ag-cell-not-inline-editing");
    expect(s.solid).toContain("ag-cell-value");

    // 1. inline start
    solid.api()!.startEditingCell({ rowIndex: 0, colKey: "make" });
    vanilla.api.startEditingCell({ rowIndex: 0, colKey: "make" });
    await waitFor(() =>
      cellFor(solid.container, 0, "make")!.classList.contains("ag-cell-inline-editing"),
    );
    await waitFor(() =>
      cellFor(vanilla.container, 0, "make")!.classList.contains("ag-cell-inline-editing"),
    );
    s = snapshot("make");
    expect(s.solid).toEqual(s.vanilla);

    // 2. inline stop
    solid.api()!.stopEditing();
    vanilla.api.stopEditing();
    await waitFor(
      () => !cellFor(solid.container, 0, "make")!.classList.contains("ag-cell-inline-editing"),
    );
    await waitFor(
      () => !cellFor(vanilla.container, 0, "make")!.classList.contains("ag-cell-inline-editing"),
    );
    s = snapshot("make");
    expect(s.solid).toEqual(s.vanilla);

    // 3. popup start
    solid.api()!.startEditingCell({ rowIndex: 0, colKey: "notes" });
    vanilla.api.startEditingCell({ rowIndex: 0, colKey: "notes" });
    await waitFor(() =>
      cellFor(solid.container, 0, "notes")!.classList.contains("ag-cell-popup-editing"),
    );
    await waitFor(() =>
      cellFor(vanilla.container, 0, "notes")!.classList.contains("ag-cell-popup-editing"),
    );
    s = snapshot("notes");
    expect(s.solid).toEqual(s.vanilla);
    expect(s.solid).toContain("ag-cell-popup-editing");

    // 4. popup stop
    solid.api()!.stopEditing();
    vanilla.api.stopEditing();
    await waitFor(
      () => !cellFor(solid.container, 0, "notes")!.classList.contains("ag-cell-popup-editing"),
    );
    await waitFor(
      () => !cellFor(vanilla.container, 0, "notes")!.classList.contains("ag-cell-popup-editing"),
    );
    s = snapshot("notes");
    expect(s.solid).toEqual(s.vanilla);

    vanilla.destroy();
    solid.unmount();
  });

  it("tool widgets follow the wrapper like vanilla: inline edit hides/restores them in place; rowSelection round trip; no errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // rowDrag puts a tool widget INSIDE the editable cell (selection checkboxes live in the
    // dedicated selection column in v36, so they never share a cell with an editor)
    const base: GridOptions<CarRow> = {
      columnDefs: [{ field: "make", editable: true, rowDrag: true }, { field: "notes" }],
      rowData: rowData(),
      rowSelection: { mode: "multiRow", checkboxes: true, enableClickSelection: false },
    };
    const vanilla = mountVanilla(base);
    const solid = mountSolid(base);
    const counts = (root: Element) => ({
      tools: root.querySelectorAll(".ag-cell .ag-row-drag, .ag-cell .ag-selection-checkbox").length,
      wrappers: root.querySelectorAll(".ag-cell .ag-cell-wrapper").length,
      editors: root.querySelectorAll(".ag-cell.ag-cell-inline-editing").length,
    });
    // tools + editors must match vanilla at every step; the wrapper div itself is compared
    // outside edit sessions only (during inline editing vanilla keeps an empty wrapper while
    // the React port — and this one — drop it; classes and content are what users see)
    const same = (a: ReturnType<typeof counts>, b: ReturnType<typeof counts>) =>
      a.tools === b.tools && a.editors === b.editors;
    const settleAndCompare = async (label: string, compareWrappers: boolean) => {
      await new Promise<void>((r) => setTimeout(r, 50));
      const expected = counts(vanilla.container);
      try {
        await waitFor(
          () =>
            same(counts(solid.container), expected) &&
            (!compareWrappers || counts(solid.container).wrappers === expected.wrappers),
        );
      } catch {
        throw new Error(
          `${label}: solid ${JSON.stringify(counts(solid.container))} vs vanilla ${JSON.stringify(expected)}`,
        );
      }
      return expected;
    };
    const dragHandle = (root: Element) => cellFor(root, 0, "make")!.querySelector(".ag-row-drag");

    const atMount = await settleAndCompare("mount", true);
    expect(atMount.tools).toBe(6); // 3 checkboxes (selection column) + 3 drag handles
    expect(dragHandle(solid.container)).not.toBeNull();

    // in-place toggle: inline editing on the tools cell removes its tool widgets (the wrapper
    // scope unmounts around the edit session — the seam the diet relocates), restored after
    solid.api()!.startEditingCell({ rowIndex: 0, colKey: "make" });
    vanilla.api.startEditingCell({ rowIndex: 0, colKey: "make" });
    const editing = await settleAndCompare("inline editing on the drag cell", false);
    expect(editing.editors).toBe(1);
    expect(dragHandle(solid.container)).toBeNull();
    expect(dragHandle(vanilla.container)).toBeNull();

    solid.api()!.stopEditing();
    vanilla.api.stopEditing();
    const stopped = await settleAndCompare("after stopEditing", true);
    expect(stopped.tools).toBe(6);
    expect(dragHandle(solid.container)).not.toBeNull();
    expect(cellFor(solid.container, 0, "make")!.textContent).toContain("Toyota");

    // selection-option round trip (the core rebuilds affected cells) — parity only
    const off: GridOptions<CarRow>["rowSelection"] = {
      mode: "multiRow",
      checkboxes: false,
      enableClickSelection: false,
    };
    solid.api()!.setGridOption("rowSelection", off);
    vanilla.api.setGridOption("rowSelection", off);
    await settleAndCompare("checkboxes off", true);
    solid.api()!.setGridOption("rowSelection", base.rowSelection);
    vanilla.api.setGridOption("rowSelection", base.rowSelection);
    const afterOn = await settleAndCompare("checkboxes on again", true);
    expect(afterOn.tools).toBe(6);

    // DOM order inside the drag cell's wrapper is preserved: drag handle then value
    const wrapper = cellFor(solid.container, 0, "make")!.querySelector(".ag-cell-wrapper")!;
    expect(wrapper.firstElementChild!.classList.contains("ag-row-drag")).toBe(true);
    expect(wrapper.lastElementChild!.classList.contains("ag-cell-value")).toBe(true);
    // and a checkbox still works after the round trip
    (
      solid.container.querySelector(
        '.ag-row[row-index="1"] .ag-selection-checkbox input',
      ) as HTMLElement
    ).click();
    await waitFor(() => solid.api()!.getSelectedRows().length === 1);
    expect(errorSpy).not.toHaveBeenCalled();
    vanilla.destroy();
    solid.unmount();
  });
});
