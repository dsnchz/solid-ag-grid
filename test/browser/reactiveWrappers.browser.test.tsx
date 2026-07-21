// T3.7 parity oracle: reactive custom components (reactiveCustomComponents default on) —
// grid features driven end-to-end by plain Solid components through the per-slot wrapper
// classes, compared against vanilla createGrid where an equivalent exists.
//
// Floating filters in the header filter row are NOT covered here: HeaderFilterCellComp (the
// consumer of FloatingFilterComponentProxy) lands in T3.9 — until then filter rows render
// through a temporary HeaderCellComp cast. The proxy and wrapper classes ship unit-tested.
// statusPanel/toolPanel/menuItem are enterprise-only slots: unit-tested with mocked
// componentTypes, no browser parity (per the task's out-of-scope note).
import { render } from "@solidjs/testing-library";
import type {
  GridApi,
  GridOptions,
  IDoesFilterPassParams,
  IFilter,
  IFilterParams,
} from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type {
  AgGridSolidRef,
  CustomDateProps,
  CustomFilterProps,
  CustomLoadingOverlayProps,
  CustomNoRowsOverlayProps,
} from "../../src/index";
import AgGridSolid, { getInstance, useGridFilter } from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

interface CarRow {
  make: string;
  price: number;
  bought: Date;
}

const rowData = (): CarRow[] => [
  { make: "Toyota", price: 35000, bought: new Date(2024, 0, 2) },
  { make: "Ford", price: 32000, bought: new Date(2024, 5, 10) },
  { make: "Porsche", price: 72000, bought: new Date(2025, 2, 4) },
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

const displayedMakes = (container: Element) =>
  Array.from(container.querySelectorAll('.ag-cell[col-id="make"]')).map((cell) => cell.textContent);

/** vanilla JS custom filter equivalent to the Solid one below */
class VanillaMakeFilter implements IFilter {
  private model: string | null = null;
  private eGui = document.createElement("div");

  public init(_params: IFilterParams<CarRow>): void {
    this.eGui.textContent = "vanilla make filter";
  }
  public getGui(): HTMLElement {
    return this.eGui;
  }
  public doesFilterPass(params: IDoesFilterPassParams<CarRow>): boolean {
    return this.model == null || params.data.make === this.model;
  }
  public isFilterActive(): boolean {
    return this.model != null;
  }
  public getModel(): string | null {
    return this.model;
  }
  public setModel(model: string | null): void {
    this.model = model;
  }
}

describe("Reactive custom components (browser)", () => {
  it("parity: reactive Solid filter (useGridFilter + onModelChange) filters to the same rows as an equivalent vanilla JS filter; model roundtrips; props push without remount; getInstance yields the user handle", async () => {
    type FilterHandle = { marker: string };
    const SolidMakeFilter = (
      props: CustomFilterProps<CarRow, unknown, string> & { ref?: (handle: FilterHandle) => void },
    ) => {
      useGridFilter({
        // reads the pushed model at call time — run-once Solid component, single registration
        doesFilterPass: (params: IDoesFilterPassParams<CarRow>) =>
          props.model == null || params.data.make === props.model,
      });
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref?.({ marker: "user-filter-handle" });
      return (
        <div class="solid-make-filter">
          <span class="solid-make-filter-model">{`model=${props.model ?? "none"}`}</span>
          <button class="solid-make-filter-ford" onClick={() => props.onModelChange("Ford")}>
            only Ford
          </button>
          <button class="solid-make-filter-clear" onClick={() => props.onModelChange(null)}>
            clear
          </button>
        </div>
      );
    };

    const columnDefsSolid: GridOptions<CarRow>["columnDefs"] = [
      { field: "make", filter: SolidMakeFilter },
      { field: "price" },
    ];
    const solid = mountSolid<CarRow>({ columnDefs: columnDefsSolid, rowData: rowData() });
    const vanilla = mountVanilla<CarRow>({
      columnDefs: [{ field: "make", filter: VanillaMakeFilter }, { field: "price" }],
      rowData: rowData(),
    });

    await waitFor(() => solid.api() != null && displayedMakes(solid.container).length === 3);
    await waitFor(() => displayedMakes(vanilla.container).length === 3);

    // open the filter UI — the reactive wrapper's portal comp shows inside the menu popup
    solid.api()!.showColumnFilter("make");
    await waitFor(() => document.querySelector(".solid-make-filter") != null);
    const filterRoot = document.querySelector(".solid-make-filter")!;

    // user interaction drives doesFilterPass end-to-end
    await userEvent.click(document.querySelector(".solid-make-filter-ford")!);
    await waitFor(() => displayedMakes(solid.container).join() === "Ford");

    // vanilla equivalent with the same model shows the same visible set
    await vanilla.api.setColumnFilterModel("make", "Ford");
    vanilla.api.onFilterChanged();
    await waitFor(() => displayedMakes(vanilla.container).join() === "Ford");
    expect(displayedMakes(solid.container)).toEqual(displayedMakes(vanilla.container));

    // model roundtrip through the grid API
    expect(await solid.api()!.getColumnFilterModel("make")).toBe("Ford");
    expect(solid.api()!.getFilterModel()).toEqual({ make: "Ford" });

    // programmatic model set pushes props into the MOUNTED comp — same element, no remount
    const modelSpan = document.querySelector(".solid-make-filter-model")!;
    await solid.api()!.setColumnFilterModel("make", "Porsche");
    solid.api()!.onFilterChanged();
    await waitFor(() => displayedMakes(solid.container).join() === "Porsche");
    expect(document.querySelector(".solid-make-filter")).toBe(filterRoot);
    expect(document.querySelector(".solid-make-filter-model")).toBe(modelSpan);
    expect(modelSpan.textContent).toBe("model=Porsche");

    // getInstance unwraps the wrapper to the user component's props.ref handle
    const wrapperInstance = await solid.api()!.getColumnFilterInstance<IFilter>("make");
    const handle = await new Promise<FilterHandle | undefined>((resolve) => {
      getInstance(wrapperInstance as IFilter, resolve as (c: IFilter | undefined) => void);
    });
    expect(handle).toEqual({ marker: "user-filter-handle" });

    // clearing from inside the component restores all rows
    await userEvent.click(document.querySelector(".solid-make-filter-clear")!);
    await waitFor(() => displayedMakes(solid.container).length === 3);
    expect(await solid.api()!.getColumnFilterModel("make")).toBeNull();

    solid.unmount();
    vanilla.destroy();
  });

  it("custom loading + noRows overlays run through the reactive wrapper: no deprecation warning, toggling `loading` swaps them live", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const SolidLoading = (props: CustomLoadingOverlayProps<CarRow>) => (
      <div class="solid-reactive-loading">{`loading (api=${typeof props.api})`}</div>
    );
    const SolidNoRows = (_props: CustomNoRowsOverlayProps<CarRow>) => (
      <div class="solid-reactive-norows">nothing here</div>
    );

    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make" }],
      rowData: [],
      loading: true,
      loadingOverlayComponent: SolidLoading,
      noRowsOverlayComponent: SolidNoRows,
    });

    await waitFor(() => solid.container.querySelector(".solid-reactive-loading") != null);
    // params flowed into the reactive props push (api present)
    expect(solid.container.querySelector(".solid-reactive-loading")!.textContent).toBe(
      "loading (api=object)",
    );

    // loading -> noRows -> loading, driven by grid options like vanilla
    solid.api()!.setGridOption("loading", false);
    await waitFor(() => solid.container.querySelector(".solid-reactive-norows") != null);
    expect(solid.container.querySelector(".solid-reactive-loading")).toBeNull();

    solid.api()!.setGridOption("loading", true);
    await waitFor(() => solid.container.querySelector(".solid-reactive-loading") != null);

    // reactive path taken → no "reactiveCustomComponents" deprecation warning (error #231)
    const reactiveWarnings = warnSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("reactiveCustomComponents")),
    );
    expect(reactiveWarnings).toEqual([]);
    warnSpy.mockRestore();
    solid.unmount();
  });

  it("parity: custom Solid date component drives agDateColumnFilter to the same rows as vanilla's default date input", async () => {
    const SolidDateInput = (props: CustomDateProps<CarRow>) => (
      <input
        class="solid-date-input"
        type="text"
        placeholder="yyyy-mm-dd"
        onInput={(e) => {
          // parse as LOCAL date parts — `new Date("yyyy-mm-dd")` is UTC midnight, which
          // shifts a day in negative-offset timezones
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.currentTarget.value);
          props.onDateChange(
            match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null,
          );
        }}
        value={props.date ? props.date.toISOString().slice(0, 10) : ""}
      />
    );

    // v36 resolves the custom date component from colDef.dateComponent (not a grid option)
    const dateColDef = {
      field: "bought",
      filter: "agDateColumnFilter",
      filterParams: { debounceMs: 0 },
    };
    const solid = mountSolid<CarRow>({
      columnDefs: [{ field: "make" }, { ...dateColDef, dateComponent: SolidDateInput } as never],
      rowData: rowData(),
    });
    const vanilla = mountVanilla<CarRow>({
      columnDefs: [{ field: "make" }, dateColDef as never],
      rowData: rowData(),
    });

    await waitFor(() => solid.api() != null && displayedMakes(solid.container).length === 3);

    // the community DateFilter body renders our Solid date component through the portal
    solid.api()!.showColumnFilter("bought");
    await waitFor(() => document.querySelector(".solid-date-input") != null);

    await userEvent.fill(
      document.querySelector<HTMLInputElement>(".solid-date-input")!,
      "2024-06-10",
    );
    await waitFor(() => displayedMakes(solid.container).join() === "Ford");

    // vanilla with the equivalent model (typed into its default text input path) matches
    const solidModel = await solid.api()!.getColumnFilterModel("bought");
    expect(solidModel).toMatchObject({ filterType: "date", type: "equals" });
    await vanilla.api.setColumnFilterModel("bought", solidModel);
    vanilla.api.onFilterChanged();
    await waitFor(() => displayedMakes(vanilla.container).join() === "Ford");
    expect(displayedMakes(solid.container)).toEqual(displayedMakes(vanilla.container));

    // grid → component push: clearing the model empties the custom input (no remount)
    const inputBefore = document.querySelector(".solid-date-input");
    await solid.api()!.setColumnFilterModel("bought", null);
    solid.api()!.onFilterChanged();
    await waitFor(() => displayedMakes(solid.container).length === 3);
    await waitFor(
      () => document.querySelector<HTMLInputElement>(".solid-date-input")!.value === "",
    );
    expect(document.querySelector(".solid-date-input")).toBe(inputBefore);

    solid.unmount();
    vanilla.destroy();
  });
});
