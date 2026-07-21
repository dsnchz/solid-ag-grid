// T3.6 parity oracle: JS grid features that instantiate framework (Solid) components via
// portals — overlays, tooltips, filters. Vanilla createGrid is the reference for placement.
import { render } from "@solidjs/testing-library";
import type {
  GridApi,
  GridOptions,
  IDoesFilterPassParams,
  IFilter,
  ITooltipParams,
} from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { createContext, untrack, useContext } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
}

const rowData: CarRow[] = [
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

const mountVanilla = <TData,>(options: GridOptions<TData>) => {
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

const mountSolid = <TData,>(props: GridOptions<TData>) => {
  let apiRef: AgGridSolidRef<TData> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...props}
      ref={(r: AgGridSolidRef<TData>) => (apiRef = r)}
    />
  ));
  return { ...rendered, api: () => apiRef?.api as GridApi<TData> | undefined };
};

/** class chain from el (inclusive) up to .ag-root-wrapper (exclusive) — placement fingerprint */
const chainToRootWrapper = (el: Element): string[] => {
  const chain: string[] = [];
  let cur: Element | null = el;
  while (cur && !cur.classList.contains("ag-root-wrapper")) {
    chain.push(Array.from(cur.classList).sort().join(" "));
    cur = cur.parentElement;
  }
  return chain;
};

describe("User-component portals (browser)", () => {
  it("parity: Solid noRowsOverlayComponent renders exactly where vanilla puts its default overlay, and user context propagates under the Portal", async () => {
    const UserContext = createContext<string>();

    const SolidNoRows = () => {
      const fromContext = useContext(UserContext);
      return <div class="solid-no-rows">{`no rows (ctx=${fromContext})`}</div>;
    };

    const vanilla = mountVanilla<CarRow>({
      columnDefs: [{ field: "make" }, { field: "price" }],
      rowData: [],
    });
    let apiRef: AgGridSolidRef<CarRow> | undefined;
    const solid = render(() => (
      <UserContext value="hello">
        <AgGridSolid
          containerStyle={{ height: "300px", width: "600px" }}
          columnDefs={[{ field: "make" }, { field: "price" }]}
          rowData={[]}
          noRowsOverlayComponent={SolidNoRows}
          ref={(r: AgGridSolidRef<CarRow>) => (apiRef = r)}
        />
      </UserContext>
    ));

    await waitFor(() => vanilla.container.querySelector(".ag-overlay-no-rows-center") != null);
    await waitFor(() => solid.container.querySelector(".solid-no-rows") != null);

    // context propagated from above the grid, through the portal, into the overlay comp
    const solidOverlay = solid.container.querySelector(".solid-no-rows")!;
    expect(solidOverlay.textContent).toBe("no rows (ctx=hello)");

    // placement parity: our comp sits in div.ag-solid-container exactly where vanilla puts
    // its default overlay comp — identical ancestor chain up to the root wrapper
    const solidMount = solidOverlay.closest(".ag-solid-container")!;
    expect(solidMount).not.toBeNull();
    const vanillaCenter = vanilla.container.querySelector(".ag-overlay-no-rows-center")!;
    expect(chainToRootWrapper(solidMount.parentElement!)).toEqual(
      chainToRootWrapper(vanillaCenter.parentElement!),
    );
    expect(solidMount.closest(".ag-overlay-wrapper")).not.toBeNull();

    // switching data swaps the overlay away like vanilla
    apiRef!.api.setGridOption("rowData", rowData);
    vanilla.api.setGridOption("rowData", rowData);
    await waitFor(() => solid.container.querySelector(".solid-no-rows") == null);
    await waitFor(() => vanilla.container.querySelector(".ag-overlay-no-rows-center") == null);

    vanilla.destroy();
    solid.unmount();
  });

  it("parity: Solid loadingOverlayComponent renders where vanilla puts its default loading overlay", async () => {
    const SolidLoading = () => <div class="solid-loading-overlay">loading…</div>;

    const vanilla = mountVanilla<CarRow>({
      columnDefs: [{ field: "make" }],
      rowData,
      loading: true,
    });
    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make" }],
      rowData,
      loading: true,
      loadingOverlayComponent: SolidLoading,
    });

    await waitFor(() => vanilla.container.querySelector(".ag-overlay-loading-center") != null);
    await waitFor(() => solid.container.querySelector(".solid-loading-overlay") != null);

    const solidMount = solid.container
      .querySelector(".solid-loading-overlay")!
      .closest(".ag-solid-container")!;
    const vanillaCenter = vanilla.container.querySelector(".ag-overlay-loading-center")!;
    expect(chainToRootWrapper(solidMount.parentElement!)).toEqual(
      chainToRootWrapper(vanillaCenter.parentElement!),
    );

    // hiding the overlay removes the portal comp and its wrapping element
    solid.api()!.setGridOption("loading", false);
    await waitFor(() => solid.container.querySelector(".solid-loading-overlay") == null);
    expect(solid.container.querySelector(".ag-solid-container")).toBeNull();

    vanilla.destroy();
    solid.unmount();
  });

  it("Solid tooltipComponent shows on hover (community tooltip module)", async () => {
    const SolidTooltip = (props: ITooltipParams<CarRow, string>) => (
      <div class="solid-tooltip">{`tip:${props.value}`}</div>
    );
    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make", tooltipField: "make", tooltipComponent: SolidTooltip }],
      rowData,
      tooltipShowDelay: 0,
    });
    await waitFor(() => solid.container.querySelectorAll(".ag-cell").length > 0);

    // real mouse movement (CDP) — AG Grid's tooltip tracking ignores synthetic MouseEvents
    const cell = solid.container.querySelector<HTMLElement>('.ag-cell[col-id="make"]')!;
    await userEvent.hover(cell);

    await waitFor(() => document.querySelector(".solid-tooltip") != null);
    expect(document.querySelector(".solid-tooltip")!.textContent).toBe("tip:Toyota");

    // destroying the grid tears the tooltip portal down with it
    solid.unmount();
    await waitFor(() => document.querySelector(".solid-tooltip") == null);
    expect(document.querySelectorAll(".ag-solid-container").length).toBe(0);
  });

  it("Solid filter component: instance registered via props.ref drives the real filter pipeline (waitForInstance + callMethod through the grid core)", async () => {
    type MakeFilterModel = { value: string };
    let filterParamsSeen = false;

    const SolidFilter = (props: Record<string, unknown> & { ref: (handle: IFilter) => void }) => {
      let model: MakeFilterModel | null = null;
      // §7.1 convention: portal props are signal-backed — capture body reads via untrack
      filterParamsSeen = untrack(() => typeof props.filterChangedCallback === "function");
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref({
        doesFilterPass: (params: IDoesFilterPassParams<CarRow>) =>
          model == null || params.data.make === model.value,
        isFilterActive: () => model != null,
        getModel: () => model,
        setModel: (m: MakeFilterModel | null) => {
          model = m;
        },
      });
      return <div class="solid-filter">custom filter body</div>;
    };

    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make", filter: SolidFilter }, { field: "price" }],
      rowData,
    });
    await waitFor(() => solid.api() != null);
    await waitFor(() => solid.api()!.getDisplayedRowCount() === 3);

    // creating the filter goes through SolidFrameworkComponentWrapper → SolidComponent →
    // portal → waitForInstance; the grid unwraps getFrameworkComponentInstance() to hand back
    // the Solid handle (the JS-context "Solid component instance" acceptance)
    const instance = await solid.api()!.getColumnFilterInstance<IFilter>("make");
    expect(instance).toBeDefined();
    expect(typeof instance!.doesFilterPass).toBe("function");
    expect(filterParamsSeen).toBe(true);

    const displayedMakes = () =>
      Array.from(solid.container.querySelectorAll('.ag-cell[col-id="make"]')).map(
        (cell) => cell.textContent,
      );

    await solid.api()!.setColumnFilterModel("make", { value: "Ford" });
    solid.api()!.onFilterChanged();
    // DOM-driven condition: row DOM lands a flush after the model updates
    await waitFor(() => displayedMakes().length === 1 && displayedMakes()[0] === "Ford");
    expect(await solid.api()!.getColumnFilterModel("make")).toEqual({ value: "Ford" });

    // clearing restores all rows
    await solid.api()!.setColumnFilterModel("make", null);
    solid.api()!.onFilterChanged();
    await waitFor(() => displayedMakes().length === 3);

    solid.unmount();
  });

  it("portal cleanup: destroying the grid removes every portal-mounted comp with no leaked DOM and no console errors", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const SolidNoRows = () => <div class="solid-no-rows">empty</div>;
    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make" }],
      rowData: [],
      noRowsOverlayComponent: SolidNoRows,
    });
    await waitFor(() => solid.container.querySelector(".solid-no-rows") != null);

    solid.unmount();
    await waitFor(() => document.querySelector(".solid-no-rows") == null);
    expect(document.querySelectorAll(".ag-solid-container").length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
