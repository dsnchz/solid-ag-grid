import { render } from "@solidjs/testing-library";
import type { ColDef } from "ag-grid-community";
import { AllCommunityModule, getGridApi, ModuleRegistry } from "ag-grid-community";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// grid creation runs in onSettled, GridComp/TabGuardComp mount on subsequent flushes and the
// selector effect on the one after — a macrotask boundary drains them all
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("GridComp + TabGuardComp shell (jsdom)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error");
  });

  afterEach(() => {
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("renders the grid shell: root wrapper > body > tab guards around the grid body", async () => {
    const { container } = render(() => <AgGridSolid columnDefs={columnDefs} rowData={rowData} />);
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper") as HTMLDivElement;
    expect(rootWrapper).not.toBeNull();
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(true);
    expect(rootWrapper.getAttribute("role")).toBe("presentation");
    // GridCtrl.setComp stamps the grid id on the root wrapper
    expect(rootWrapper.getAttribute("grid-id")).toBeTruthy();

    const body = rootWrapper.firstElementChild as HTMLDivElement;
    expect(body.classList.contains("ag-root-wrapper-body")).toBe(true);
    expect(body.classList.contains("ag-focus-managed")).toBe(true);
    expect(body.classList.contains("ag-layout-normal")).toBe(true);

    const children = Array.from(body.children);
    expect(children[0]!.classList.contains("ag-tab-guard")).toBe(true);
    expect(children[0]!.classList.contains("ag-tab-guard-top")).toBe(true);
    expect(children[children.length - 1]!.classList.contains("ag-tab-guard-bottom")).toBe(true);
    // the grid body sits between the guards
    const agRoot = body.querySelector(".ag-root");
    expect(agRoot).not.toBeNull();
    expect(Array.from(body.children).indexOf(agRoot as HTMLElement)).toBe(1);

    // TabGuardCtrl activates the guards with the grid's tabindex
    expect(children[0]!.getAttribute("tabindex")).toBe("0");
    expect(children[children.length - 1]!.getAttribute("tabindex")).toBe("0");
  });

  it("inserts the ` AG Grid ` DOM comment before the root wrapper", async () => {
    const { container } = render(() => <AgGridSolid columnDefs={columnDefs} rowData={rowData} />);
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper")!;
    const siblings = Array.from(rootWrapper.parentElement!.childNodes);
    const wrapperIndex = siblings.indexOf(rootWrapper);
    const commentBefore = siblings
      .slice(0, wrapperIndex)
      .find((n) => n.nodeType === Node.COMMENT_NODE && n.nodeValue === " AG Grid ");
    expect(commentBefore).toBeDefined();
  });

  it("updates layout classes when domLayout changes through the grid api (compProxy push path)", async () => {
    const { container } = render(() => <AgGridSolid columnDefs={columnDefs} rowData={rowData} />);
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper") as HTMLDivElement;
    const body = rootWrapper.firstElementChild as HTMLDivElement;
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(true);

    const api = getGridApi(container.firstElementChild)!;
    api.setGridOption("domLayout", "autoHeight");
    await settle();

    expect(rootWrapper.classList.contains("ag-layout-auto-height")).toBe(true);
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(false);
    expect(body.classList.contains("ag-layout-auto-height")).toBe(true);

    api.setGridOption("domLayout", "normal");
    await settle();
    expect(rootWrapper.classList.contains("ag-layout-normal")).toBe(true);
    expect(rootWrapper.classList.contains("ag-layout-auto-height")).toBe(false);
  });

  it("attaches the pagination selector comp and removes it again on unmount", async () => {
    const { container, unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowData={rowData} pagination={true} />
    ));
    await settle();

    const rootWrapper = container.querySelector(".ag-root-wrapper") as HTMLDivElement;
    // pagination panel appended `beforeend` on the root wrapper, after the body div
    const paging = rootWrapper.querySelector(".ag-paging-panel");
    expect(paging).not.toBeNull();
    expect(paging!.parentElement).toBe(rootWrapper);
    expect(Array.from(rootWrapper.children).indexOf(paging as HTMLElement)).toBeGreaterThan(0);

    const api = getGridApi(container.firstElementChild)!;
    unmount();
    // context destroy is clean: GridCtrl, TabGuardCtrl and the selector beans all destroyed
    // without console.error (asserted in afterEach)
    expect(api.isDestroyed()).toBe(true);
  });

  it("destroys the grid shell cleanly on unmount without selector comps", async () => {
    const { container, unmount } = render(() => (
      <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
    ));
    await settle();

    const api = getGridApi(container.firstElementChild)!;
    expect(api.isDestroyed()).toBe(false);
    unmount();
    expect(api.isDestroyed()).toBe(true);
  });
});
