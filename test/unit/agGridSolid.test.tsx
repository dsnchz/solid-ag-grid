import { render } from "@solidjs/testing-library";
import type { ColDef } from "ag-grid-community";
import {
  _processOnChange,
  AllCommunityModule,
  getGridApi,
  ModuleRegistry,
} from "ag-grid-community";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

vi.mock("ag-grid-community", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ag-grid-community")>();
  return { ...mod, _processOnChange: vi.fn(mod._processOnChange) };
});

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  model: string;
  price: number;
}

const columnDefs: ColDef<CarRow>[] = [{ field: "make" }, { field: "model" }, { field: "price" }];

const rowData: CarRow[] = [
  { make: "Toyota", model: "Celica", price: 35000 },
  { make: "Ford", model: "Mondeo", price: 32000 },
];

// grid creation runs in onSettled + GridComp mounts on the following flush, so let the
// microtask/timer queue drain fully
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("AgGridSolid entry (jsdom)", () => {
  it("boots a real grid core: styled-root layers render and the GridApi is created", async () => {
    const { container } = render(() => <AgGridSolid columnDefs={columnDefs} rowData={rowData} />);
    await settle();

    const outermost = container.firstElementChild as HTMLDivElement;
    expect(outermost).toBeInstanceOf(HTMLDivElement);
    expect(outermost.style.width).toBe("100%");
    expect(outermost.style.height).toBe("100%");

    // 3 bare styled-root layer divs between the user container and the grid UI
    const layer1 = outermost.firstElementChild as HTMLDivElement;
    const layer2 = layer1.firstElementChild as HTMLDivElement;
    const layer3 = layer2.firstElementChild as HTMLDivElement;
    for (const layer of [layer1, layer2, layer3]) {
      expect(layer).toBeInstanceOf(HTMLDivElement);
    }

    // the innermost layer hosts the (stub) GridComp
    expect(layer3.querySelector(".ag-root-wrapper")).not.toBeNull();

    const api = getGridApi(outermost);
    expect(api).toBeDefined();
    expect(typeof api!.getGridId()).toBe("string");
    expect(api!.isDestroyed()).toBe(false);
  });

  it("applies user class and containerStyle to the outermost div only", async () => {
    const { container } = render(() => (
      <AgGridSolid
        class="my-grid"
        containerStyle={{ height: "300px" }}
        columnDefs={columnDefs}
        rowData={rowData}
      />
    ));
    await settle();

    const outermost = container.firstElementChild as HTMLDivElement;
    expect(outermost.classList.contains("my-grid")).toBe(true);
    expect(outermost.style.height).toBe("300px");
    // the layer divs carry no user classes — only what the styled-root system installs
    const layer1 = outermost.firstElementChild as HTMLDivElement;
    expect(layer1.classList.contains("my-grid")).toBe(false);
    expect(layer1.classList.contains("ag-styled-root")).toBe(true);
  });

  it("queues reactive prop changes while the grid is not ready, then drains them once it is", async () => {
    const [rows, setRows] = createSignal<CarRow[]>(rowData);
    const { container } = render(() => <AgGridSolid columnDefs={columnDefs} rowData={rows()} />);

    const processOnChangeSpy = vi.mocked(_processOnChange);
    processOnChangeSpy.mockClear();

    // change the prop before the grid has settled: ctrlsSvc is not ready yet, so the change is
    // queued in whenReadyFuncs...
    setRows([...rowData, { make: "Porsche", model: "Boxster", price: 72000 }]);
    await settle();

    // ...and with the full body/header comps (T3.3) registering all required ctrls, whenReady
    // fires and acceptChangesCallback drains the queue through _processOnChange
    expect(processOnChangeSpy).toHaveBeenCalledTimes(1);
    const [changes, apiArg] = processOnChangeSpy.mock.calls[0]!;
    expect(Object.keys(changes)).toEqual(["rowData"]);

    const api = getGridApi(container.firstElementChild)!;
    expect(api.isDestroyed()).toBe(false);
    expect(apiArg).toBe(api);
    expect(api.getDisplayedRowCount()).toBe(3);
  });

  it("surfaces the api via props.ref and fires onGridReady once all ctrls are ready", async () => {
    const refSpy = vi.fn();
    const onGridReadySpy = vi.fn();
    render(() => (
      <AgGridSolid
        columnDefs={columnDefs}
        rowData={rowData}
        ref={refSpy}
        onGridReady={onGridReadySpy}
      />
    ));
    await settle();

    expect(onGridReadySpy).toHaveBeenCalledTimes(1);
    expect(refSpy).toHaveBeenCalledTimes(1);
    const ref = refSpy.mock.calls[0]![0];
    expect(ref.api).toBeDefined();
    expect(ref.api.isDestroyed()).toBe(false);
  });

  it("destroys the grid context on unmount", async () => {
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
