import { render } from "@solidjs/testing-library";
import type { ColDef, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, getGridApi, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
}

const columnDefs: ColDef<CarRow>[] = [{ field: "make" }, { field: "price" }];
const rowData: CarRow[] = [
  { make: "Toyota", price: 35000 },
  { make: "Ford", price: 32000 },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Mounts a vanilla (createGrid) grid with the given options; returns its container + destroy. */
const mountVanilla = (options: GridOptions<CarRow>) => {
  const container = document.createElement("div");
  container.style.height = "300px";
  container.style.width = "600px";
  document.body.appendChild(container);
  const api = createGrid(container, options);
  return {
    container,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
};

const sortedClasses = (el: Element) => Array.from(el.classList).sort();

describe("GridComp shell (browser)", () => {
  it("renders wrapper > body > tab guards around the stub body, with the AG Grid comment", async () => {
    const { container, unmount } = render(() => (
      <AgGridSolid containerStyle={{ height: "300px" }} columnDefs={columnDefs} rowData={rowData} />
    ));
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper") as HTMLDivElement;
    expect(rootWrapper).not.toBeNull();
    const body = rootWrapper.firstElementChild as HTMLDivElement;
    expect(body.classList.contains("ag-root-wrapper-body")).toBe(true);
    expect(body.classList.contains("ag-focus-managed")).toBe(true);

    const children = Array.from(body.children);
    expect(children[0]!.className).toContain("ag-tab-guard-top");
    expect(children[1]!.classList.contains("ag-root")).toBe(true);
    expect(children[2]!.className).toContain("ag-tab-guard-bottom");
    expect(children[0]!.getAttribute("tabindex")).toBe("0");
    expect(children[2]!.getAttribute("tabindex")).toBe("0");

    const siblings = Array.from(rootWrapper.parentElement!.childNodes);
    const commentBefore = siblings
      .slice(0, siblings.indexOf(rootWrapper))
      .find((n) => n.nodeType === Node.COMMENT_NODE && n.nodeValue === " AG Grid ");
    expect(commentBefore).toBeDefined();

    unmount();
  });

  it("matches the vanilla grid's wrapper/tab-guard skeleton down to the grid-body level", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid containerStyle={{ height: "300px" }} columnDefs={columnDefs} rowData={rowData} />
    ));
    await settle();

    const vRoot = vanilla.container.querySelector(".ag-root-wrapper")!;
    const sRoot = container.querySelector(".ag-root-wrapper")!;
    expect(sortedClasses(sRoot)).toEqual(sortedClasses(vRoot));

    const vBody = vanilla.container.querySelector(".ag-root-wrapper-body")!;
    const sBody = container.querySelector(".ag-root-wrapper-body")!;
    expect(sortedClasses(sBody)).toEqual(sortedClasses(vBody));

    // both place the tab guards first/last inside the body wrapper
    const vBodyChildren = Array.from(vBody.children);
    const sBodyChildren = Array.from(sBody.children);
    expect(vBodyChildren[0]!.className).toContain("ag-tab-guard-top");
    expect(sBodyChildren[0]!.className).toContain("ag-tab-guard-top");
    expect(vBodyChildren[vBodyChildren.length - 1]!.className).toContain("ag-tab-guard-bottom");
    expect(sBodyChildren[sBodyChildren.length - 1]!.className).toContain("ag-tab-guard-bottom");

    // the element between the guards is the grid body root in both
    // (vanilla renders the full body; ours is the T3.3 stub — compare only the root class)
    expect(vBody.querySelector(".ag-root")).not.toBeNull();
    expect(sBody.querySelector(".ag-root")).not.toBeNull();
    expect(sBody.querySelector(".ag-root")!.classList.contains("ag-unselectable")).toBe(
      vBody.querySelector(".ag-root")!.classList.contains("ag-unselectable"),
    );

    vanilla.destroy();
    unmount();
  });

  it("parity: pagination selector renders the paging panel in the same wrapper position as vanilla", async () => {
    const options: GridOptions<CarRow> = { columnDefs, rowData, pagination: true };
    const vanilla = mountVanilla(options);
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px" }}
        columnDefs={columnDefs}
        rowData={rowData}
        pagination={true}
      />
    ));
    await settle();

    const vWrapper = vanilla.container.querySelector(".ag-root-wrapper")!;
    const sWrapper = container.querySelector(".ag-root-wrapper")!;
    const vPaging = vWrapper.querySelector(".ag-paging-panel")!;
    const sPaging = sWrapper.querySelector(".ag-paging-panel")!;
    expect(vPaging).not.toBeNull();
    expect(sPaging).not.toBeNull();
    // both are direct children of the root wrapper, after the body div
    expect(vPaging.parentElement).toBe(vWrapper);
    expect(sPaging.parentElement).toBe(sWrapper);
    expect(Array.from(vWrapper.children).indexOf(vPaging)).toBeGreaterThan(
      Array.from(vWrapper.children).indexOf(vWrapper.querySelector(".ag-root-wrapper-body")!),
    );
    expect(Array.from(sWrapper.children).indexOf(sPaging)).toBeGreaterThan(
      Array.from(sWrapper.children).indexOf(sWrapper.querySelector(".ag-root-wrapper-body")!),
    );

    vanilla.destroy();
    unmount();
  });

  it("updates layout classes when domLayout changes (ag-layout-normal ↔ ag-layout-auto-height)", async () => {
    const { container, unmount } = render(() => (
      <AgGridSolid containerStyle={{ height: "300px" }} columnDefs={columnDefs} rowData={rowData} />
    ));
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper") as HTMLDivElement;
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(true);

    const api = getGridApi(container.firstElementChild)!;
    api.setGridOption("domLayout", "autoHeight");
    await settle();
    expect(rootWrapper.classList.contains("ag-layout-auto-height")).toBe(true);
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(false);

    api.setGridOption("domLayout", "normal");
    await settle();
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(true);

    unmount();
  });
});
