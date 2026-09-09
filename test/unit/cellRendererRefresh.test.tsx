// The refresh bridge for framework (Solid) cell renderers that expose an imperative handle via
// props.ref({ refresh }). Pins the contract the per-cell diet must preserve while relocating the
// bridge from a per-cell effect into the framework-renderer branch:
// 1. refresh(params) is called with the NEW params on a value change;
// 2. by the time refresh runs, the renderer's reactive props ALREADY reflect the new value
//    (Solid ordering: the prop spread applies before the bridge effect runs);
// 3. refresh → true keeps the mounted instance (no body re-run); refresh → false remounts;
// 4. api.getCellRendererInstances() returns the handle (ICellComp.getCellRenderer).
import { render } from "@solidjs/testing-library";
import type { ColDef, GridApi, GridOptions, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; make: string };
const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const makeRenderer = (refreshResult: boolean) => {
  const log = { bodyRuns: 0, refreshCalls: [] as { param: unknown; prop: unknown }[] };
  const Renderer = (props: ICellRendererParams<Row> & { ref?: (h: unknown) => void }) => {
    log.bodyRuns++;
    const handle = {
      refresh: (params: ICellRendererParams<Row>) => {
        log.refreshCalls.push({ param: params.value, prop: props.value });
        return refreshResult;
      },
    };
    // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom
    props.ref?.(handle);
    return <span class="rr">{props.value}</span>;
  };
  return { Renderer, log, handle: () => log };
};

const mount = (Renderer: ColDef<Row>["cellRenderer"]) => {
  let apiRef: AgGridSolidRef<Row> | undefined;
  const options: GridOptions<Row> = {
    columnDefs: [{ field: "make", cellRenderer: Renderer }],
    rowData: [{ id: "a", make: "Toyota" }],
    getRowId: (p) => p.data.id,
  };
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...options}
      ref={(r: AgGridSolidRef<Row>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<Row> | undefined };
};

describe("framework cell renderer refresh handle", () => {
  it("refresh(params) runs after the props already carry the new value; true keeps the instance", async () => {
    const { Renderer, log } = makeRenderer(true);
    const solid = mount(Renderer);
    await waitFor(() => solid.container.querySelector(".rr")?.textContent === "Toyota");
    expect(log.bodyRuns).toBe(1);
    // the handle is what the grid sees as the renderer instance
    const instances = solid.api()!.getCellRendererInstances({ columns: ["make"] });
    expect(instances).toHaveLength(1);
    expect(typeof (instances[0] as { refresh?: unknown }).refresh).toBe("function");

    solid.api()!.getRowNode("a")!.setDataValue("make", "Honda");
    await waitFor(() => log.refreshCalls.length === 1);
    expect(log.refreshCalls[0]).toEqual({ param: "Honda", prop: "Honda" });
    await waitFor(() => solid.container.querySelector(".rr")?.textContent === "Honda");
    expect(log.bodyRuns).toBe(1);
    solid.unmount();
  });

  it("refresh → false forces a remount (renderKey bump) and the new instance shows the new value", async () => {
    const { Renderer, log } = makeRenderer(false);
    const solid = mount(Renderer);
    await waitFor(() => solid.container.querySelector(".rr")?.textContent === "Toyota");
    const before = solid.container.querySelector(".rr")!;

    solid.api()!.getRowNode("a")!.setDataValue("make", "Honda");
    await waitFor(() => log.bodyRuns === 2);
    await waitFor(() => solid.container.querySelector(".rr")?.textContent === "Honda");
    expect(log.refreshCalls).toHaveLength(1);
    expect(solid.container.querySelector(".rr")).not.toBe(before);
    solid.unmount();
  });
});
