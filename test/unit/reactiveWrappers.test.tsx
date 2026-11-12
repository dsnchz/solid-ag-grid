// T3.7: reactive custom-component wrappers/proxies driven directly against the real
// GridPortals render loop with mocked componentTypes/params — no grid core involved (the
// browser suite covers the end-to-end parity oracle; enterprise-only slots — statusPanel,
// toolPanel, menuItem — are unit-tested here only, per the task's out-of-scope note).
// Exception: behaviors whose observable lives in the grid core (the real ProvidedFilter's
// deprecation warning, the enableFilterHandlers display path, the 36.3 overlay slots, the
// reactiveCustomComponents=false fallback) mount a real AgGridSolid in jsdom.
import { render } from "@solidjs/testing-library";
import type {
  ComponentType,
  FilterDisplayParams,
  FloatingFilterDisplayParams,
  GridApi,
  GridOptions,
  ICellEditorParams,
  IDateParams,
  IDoesFilterPassParams,
  IFilter,
  IFilterParams,
  IFloatingFilterParams,
  IMenuItemParams,
  IOverlayParams,
  IStatusPanelParams,
  IToolPanelParams,
  TextFilterModel,
} from "ag-grid-community";
import {
  _warnForGrid,
  AllCommunityModule,
  ModuleRegistry,
  ProvidedFilter,
} from "ag-grid-community";
import { createSignal, untrack } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import GridPortals from "../../src/core/gridPortals";
import { PortalManager } from "../../src/core/portalManager";
import type { UserSolidComponent } from "../../src/core/solidComponent";
import { CellEditorComponentProxy } from "../../src/customComp/cellEditorComponentProxy";
import { CellRendererComponentWrapper } from "../../src/customComp/cellRendererComponentWrapper";
import { ColumnSelectionLabelRendererComponentWrapper } from "../../src/customComp/columnSelectionLabelRendererComponentWrapper";
import { CustomOverlayComponentWrapper } from "../../src/customComp/customOverlayComponentWrapper";
import { DateComponentWrapper } from "../../src/customComp/dateComponentWrapper";
import { DragAndDropImageComponentWrapper } from "../../src/customComp/dragAndDropImageComponentWrapper";
import { FilterComponentWrapper } from "../../src/customComp/filterComponentWrapper";
import { FilterDisplayComponentWrapper } from "../../src/customComp/filterDisplayComponentWrapper";
import { FloatingFilterComponentProxy } from "../../src/customComp/floatingFilterComponentProxy";
import { FloatingFilterComponentWrapper } from "../../src/customComp/floatingFilterComponentWrapper";
import { FloatingFilterDisplayComponentWrapper } from "../../src/customComp/floatingFilterDisplayComponentWrapper";
import {
  useGridDate,
  useGridFilter,
  useGridFilterDisplay,
  useGridMenuItem,
} from "../../src/customComp/hooks";
import { InnerHeaderComponentWrapper } from "../../src/customComp/innerHeaderComponentWrapper";
import { MenuItemComponentWrapper } from "../../src/customComp/menuItemComponentWrapper";
import { StatusPanelComponentWrapper } from "../../src/customComp/statusPanelComponentWrapper";
import { ToolPanelComponentWrapper } from "../../src/customComp/toolPanelComponentWrapper";
import type {
  AgGridSolidRef,
  CustomFilterDisplayProps,
  CustomFloatingFilterDisplayProps,
  CustomFloatingFilterProps,
  CustomOverlayProps,
} from "../../src/index";
import AgGridSolid from "../../src/index";

vi.mock("ag-grid-community", async (importOriginal) => {
  const mod = await importOriginal<typeof import("ag-grid-community")>();
  // spied so the reactiveCustomComponents=false warning's grid attribution is observable
  // (the console line carries only the id)
  return { ...mod, _warnForGrid: vi.fn(mod._warnForGrid) };
});

ModuleRegistry.registerModules([AllCommunityModule]);

const waitFor = async (cond: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

const mountPortalHost = (portalManager: PortalManager) =>
  render(() => <GridPortals portalManager={portalManager} />);

/** awaits an AgPromise (thenable but not a real Promise) */
const agPromiseToPromise = <T,>(agPromise: { then: (fn: (value: T) => void) => void }) =>
  new Promise<T>((resolve) => agPromise.then(resolve));

const newHostedManager = () => {
  const portalManager = new PortalManager();
  mountPortalHost(portalManager);
  return portalManager;
};

interface CarRow {
  make: string;
  price: number;
}

const carRows = (): CarRow[] => [
  { make: "Toyota", price: 35000 },
  { make: "Ford", price: 32000 },
  { make: "Porsche", price: 72000 },
];

/** a real grid in jsdom, for behaviors whose observable lives in the grid core */
const mountGrid = (options: GridOptions<CarRow>) => {
  let gridRef: AgGridSolidRef<CarRow> | undefined;
  const rendered = render(() => (
    <AgGridSolid
      containerStyle={{ height: "300px", width: "600px" }}
      {...options}
      ref={(r: AgGridSolidRef<CarRow>) => (gridRef = r)}
    />
  ));
  return { ...rendered, api: () => gridRef?.api as GridApi<CarRow> | undefined };
};

describe("FilterComponentWrapper (jsdom)", () => {
  const filterType: ComponentType = { name: "filter" };

  type Row = { make: string };
  const filterParams = () =>
    ({
      filterChangedCallback: vi.fn(),
      filterModifiedCallback: vi.fn(),
      colDef: {},
    }) as unknown as IFilterParams;

  /** filter comp registering callbacks via the public useGridFilter hook */
  const makeFilterComp = () => {
    const captured: { onModelChange?: (model: string | null) => void; onUiChange?: () => void } =
      {};
    const Comp: UserSolidComponent = (props) => {
      captured.onModelChange = untrack(() => props.onModelChange);
      captured.onUiChange = untrack(() => props.onUiChange);
      useGridFilter({
        // reads the pushed props signal at call time — the run-once Solid analog of
        // React's re-registered closure
        doesFilterPass: (p: IDoesFilterPassParams<Row>) =>
          props.model == null || p.data.make === props.model,
        getModelAsString: () => `as-string:${props.model}`,
      });
      return <div class="custom-filter">{`model=${props.model ?? "none"}`}</div>;
    };
    return { Comp, captured };
  };

  it("implements IFilter over the pushed model: isFilterActive/getModel/setModel/doesFilterPass", async () => {
    const portalManager = newHostedManager();
    const { Comp } = makeFilterComp();
    const wrapper = new FilterComponentWrapper(Comp, portalManager, filterType);
    await agPromiseToPromise(wrapper.init(filterParams()));

    expect(wrapper.isFilterActive()).toBe(false);
    expect(wrapper.getModel()).toBeNull();
    expect(wrapper.getGui().textContent).toBe("model=none");

    const elementBefore = wrapper.getRootElement();
    await agPromiseToPromise(wrapper.setModel("Ford"));

    expect(wrapper.isFilterActive()).toBe(true);
    expect(wrapper.getModel()).toBe("Ford");
    // model pushed into the live comp — no remount
    expect(wrapper.getGui().textContent).toBe("model=Ford");
    expect(wrapper.getRootElement()).toBe(elementBefore);

    // doesFilterPass delegates to the hook-registered callback reading the pushed model
    expect(wrapper.doesFilterPass({ data: { make: "Ford" } } as IDoesFilterPassParams<Row>)).toBe(
      true,
    );
    expect(wrapper.doesFilterPass({ data: { make: "Kia" } } as IDoesFilterPassParams<Row>)).toBe(
      false,
    );

    wrapper.destroy();
  });

  it("onModelChange from the component triggers filterChangedCallback after the props applied", async () => {
    const portalManager = newHostedManager();
    const { Comp, captured } = makeFilterComp();
    const params = filterParams();
    const wrapper = new FilterComponentWrapper(Comp, portalManager, filterType);
    await agPromiseToPromise(wrapper.init(params));

    captured.onModelChange!("Toyota");
    await waitFor(
      () => (params.filterChangedCallback as ReturnType<typeof vi.fn>).mock.calls.length === 1,
    );
    // by filtering time the pushed model has applied — doesFilterPass sees it
    expect(wrapper.getModel()).toBe("Toyota");
    expect(wrapper.getGui().textContent).toBe("model=Toyota");
    expect(wrapper.doesFilterPass({ data: { make: "Toyota" } } as IDoesFilterPassParams<Row>)).toBe(
      true,
    );

    // onUiChange maps to filterModifiedCallback
    captured.onUiChange!();
    expect(params.filterModifiedCallback).toHaveBeenCalledTimes(1);

    wrapper.destroy();
  });

  it("attaches optional methods from the hook and queues afterGuiAttached until setMethods ran", async () => {
    const portalManager = newHostedManager();
    const afterGuiAttached = vi.fn();
    const Comp: UserSolidComponent = () => {
      useGridFilter({ doesFilterPass: () => true, afterGuiAttached });
      return <div>f</div>;
    };
    const wrapper = new FilterComponentWrapper(Comp, portalManager, filterType);
    const initPromise = wrapper.init(filterParams());
    // called before the portal rendered (setMethods not run yet) → awaits registration
    wrapper.afterGuiAttached({ container: "columnMenu" });
    await agPromiseToPromise(initPromise);
    await waitFor(() => afterGuiAttached.mock.calls.length === 1);
    expect(afterGuiAttached).toHaveBeenCalledWith({ container: "columnMenu" });

    // optional method exposed on the wrapper for the grid core
    expect(
      (wrapper as unknown as { getModelAsString?: () => string }).getModelAsString,
    ).toBeUndefined();

    wrapper.destroy();
  });

  it("exposes hook-provided optional methods (getModelAsString) on the wrapper", async () => {
    const portalManager = newHostedManager();
    const { Comp } = makeFilterComp();
    const wrapper = new FilterComponentWrapper(Comp, portalManager, filterType);
    await agPromiseToPromise(wrapper.init(filterParams()));
    await agPromiseToPromise(wrapper.setModel("x"));

    expect((wrapper as unknown as { getModelAsString: () => string }).getModelAsString()).toBe(
      "as-string:x",
    );

    wrapper.destroy();
  });

  it("strips filterChangedCallback from the pushed props but keeps the rest of the params", async () => {
    const portalManager = newHostedManager();
    let sawFilterChangedCallback: unknown = "unset";
    let sawColDef: unknown;
    const Comp: UserSolidComponent = (props) => {
      sawFilterChangedCallback = untrack(() => props.filterChangedCallback);
      sawColDef = untrack(() => props.colDef);
      return <div>f</div>;
    };
    const wrapper = new FilterComponentWrapper(Comp, portalManager, filterType);
    const params = filterParams();
    await agPromiseToPromise(wrapper.init(params));

    expect(sawFilterChangedCallback).toBeUndefined();
    expect(sawColDef).toBe(params.colDef);

    wrapper.destroy();
  });
});

describe("FilterDisplayComponentWrapper (jsdom)", () => {
  const filterType: ComponentType = { name: "filter" };

  it("pushes refreshed params and routes afterGuiAttached through useGridFilterDisplay", async () => {
    const portalManager = newHostedManager();
    const afterGuiAttached = vi.fn();
    const Comp: UserSolidComponent = (props) => {
      useGridFilterDisplay({ afterGuiAttached });
      return <div class="fd">{`model=${props.model?.value ?? "none"}`}</div>;
    };
    const wrapper = new FilterDisplayComponentWrapper(Comp, portalManager, filterType);
    const params = { model: { value: "a" } } as unknown as FilterDisplayParams;
    const initPromise = wrapper.init(params);
    wrapper.afterGuiAttached(undefined);
    await agPromiseToPromise(initPromise);
    await waitFor(() => afterGuiAttached.mock.calls.length === 1);
    expect(wrapper.getGui().textContent).toBe("model=a");

    const elementBefore = wrapper.getRootElement();
    expect(wrapper.refresh({ model: { value: "b" } } as unknown as FilterDisplayParams)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "model=b");
    expect(wrapper.getRootElement()).toBe(elementBefore);

    wrapper.destroy();
  });
});

describe("FloatingFilterComponentWrapper (jsdom)", () => {
  const floatingFilterType: ComponentType = { name: "floatingFilterComponent" };

  it("onParentModelChanged pushes the model; onModelChange updates the parent filter", async () => {
    const portalManager = newHostedManager();
    const filterChangedCallback = vi.fn();
    const parentFilter = { setModel: vi.fn().mockReturnValue(undefined) };
    const params = {
      parentFilterInstance: (cb: (instance: unknown) => void) => cb(parentFilter),
      filterParams: { filterChangedCallback },
    } as unknown as IFloatingFilterParams;

    const captured: { onModelChange?: (model: unknown) => void } = {};
    const Comp: UserSolidComponent = (props) => {
      captured.onModelChange = untrack(() => props.onModelChange);
      return <div class="ff">{`model=${props.model ?? "none"}`}</div>;
    };
    const wrapper = new FloatingFilterComponentWrapper(Comp, portalManager, floatingFilterType);
    await agPromiseToPromise(wrapper.init(params));
    expect(wrapper.getGui().textContent).toBe("model=none");

    wrapper.onParentModelChanged("Ford");
    await waitFor(() => wrapper.getGui().textContent === "model=Ford");

    captured.onModelChange!("Kia");
    // updateFloatingFilterParent: parent setModel then filterChangedCallback
    expect(parentFilter.setModel).toHaveBeenCalledWith("Kia");
    await waitFor(() => filterChangedCallback.mock.calls.length === 1);
    await waitFor(() => wrapper.getGui().textContent === "model=Kia");

    wrapper.destroy();
  });
});

describe("FloatingFilterDisplayComponentWrapper (jsdom)", () => {
  it("refresh pushes new params", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => (
      <div class="ffd">{`model=${props.model ?? "none"}`}</div>
    );
    const wrapper = new FloatingFilterDisplayComponentWrapper(Comp, portalManager, {
      name: "floatingFilterComponent",
    });
    await agPromiseToPromise(
      wrapper.init({ model: "a" } as unknown as FloatingFilterDisplayParams),
    );
    expect(wrapper.getGui().textContent).toBe("model=a");
    wrapper.refresh({ model: "b" } as unknown as FloatingFilterDisplayParams);
    await waitFor(() => wrapper.getGui().textContent === "model=b");
    wrapper.destroy();
  });
});

describe("FloatingFilterComponentProxy (no portal)", () => {
  it("getProps exposes model/onModelChange; model changes refresh and update the parent", () => {
    const refreshProps = vi.fn();
    const filterChangedCallback = vi.fn();
    const parentFilter = { setModel: vi.fn().mockReturnValue(undefined) };
    const params = {
      parentFilterInstance: (cb: (instance: unknown) => void) => cb(parentFilter),
      filterParams: { filterChangedCallback },
    } as unknown as IFloatingFilterParams;
    const proxy = new FloatingFilterComponentProxy(params, refreshProps);

    expect(proxy.getProps().model).toBeNull();

    proxy.onParentModelChanged("Ford");
    expect(refreshProps).toHaveBeenCalledTimes(1);
    expect(proxy.getProps().model).toBe("Ford");

    proxy.getProps().onModelChange("Kia");
    expect(refreshProps).toHaveBeenCalledTimes(2);
    expect(parentFilter.setModel).toHaveBeenCalledWith("Kia");
    expect(proxy.getProps().model).toBe("Kia");

    const newParams = { ...params } as IFloatingFilterParams;
    proxy.refresh(newParams);
    expect(refreshProps).toHaveBeenCalledTimes(3);

    const afterGuiAttached = vi.fn();
    proxy.setMethods({ afterGuiAttached });
    (proxy as unknown as { afterGuiAttached: () => void }).afterGuiAttached();
    expect(afterGuiAttached).toHaveBeenCalledTimes(1);
  });

  it("onModelChange applies the model to the grid's real ProvidedFilter parent without its deprecated-setModel warning (#286)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const warned286 = () =>
      warnSpy.mock.calls.some(([message]) => message === "AG Grid: warning #286");
    const SolidFloatingFilter = (
      props: CustomFloatingFilterProps<CarRow, unknown, TextFilterModel>,
    ) => (
      <button
        class="unit-ff-ford"
        onClick={() => props.onModelChange({ filterType: "text", type: "equals", filter: "Ford" })}
      />
    );
    const grid = mountGrid({
      columnDefs: [
        {
          field: "make",
          filter: "agTextColumnFilter",
          floatingFilter: true,
          floatingFilterComponent: SolidFloatingFilter,
        },
        { field: "price" },
      ],
      rowData: carRows(),
    });
    const ford = () => grid.container.querySelector<HTMLButtonElement>(".unit-ff-ford");
    await waitFor(() => grid.api() != null && ford() != null);
    const api = grid.api()!;

    // grid-initiated: updateFloatingFilterParent → TextFilter.setModel(model, true)
    ford()!.click();
    await waitFor(() => api.getDisplayedRowCount() === 1);
    expect(api.getColumnFilterModel("make")).toEqual({
      filterType: "text",
      type: "equals",
      filter: "Ford",
    });
    expect(warned286()).toBe(false);

    // control: the same real parent filter does warn on a setModel without the flag
    const parent = await api.getColumnFilterInstance<IFilter>("make");
    expect(parent).toBeInstanceOf(ProvidedFilter);
    await parent!.setModel(null);
    expect(warned286()).toBe(true);

    warnSpy.mockRestore();
    grid.unmount();
  });
});

describe("FloatingFilterDisplayComponentProxy (enableFilterHandlers, jsdom grid)", () => {
  it("the mounted floating filter sees each refreshed model live (no remount); its onModelChange applies through the filter handler", async () => {
    let runs = 0;
    const SolidFloatingDisplay = (
      props: CustomFloatingFilterDisplayProps<CarRow, unknown, TextFilterModel>,
    ) => {
      runs++;
      return (
        <button
          class="unit-ff-display"
          onClick={() =>
            props.onModelChange({ filterType: "text", type: "equals", filter: "Porsche" })
          }
        >
          {`model=${props.model?.filter ?? "none"}`}
        </button>
      );
    };
    const grid = mountGrid({
      enableFilterHandlers: true,
      columnDefs: [
        {
          field: "make",
          filter: "agTextColumnFilter",
          floatingFilter: true,
          floatingFilterComponent: SolidFloatingDisplay,
        },
        { field: "price" },
      ],
      rowData: carRows(),
    });
    const display = () => grid.container.querySelector<HTMLButtonElement>(".unit-ff-display");
    await waitFor(() => grid.api() != null && display() != null);
    const api = grid.api()!;
    const element = display()!;
    expect(element.textContent).toBe("model=none");

    // grid → floating: the model change refreshes the display with new params
    await api.setColumnFilterModel("make", { filterType: "text", type: "equals", filter: "Ford" });
    api.onFilterChanged();
    await waitFor(() => display()?.textContent === "model=Ford");
    expect(display()).toBe(element);

    // floating → grid: the (refreshed) onModelChange applies the model through the handler
    element.click();
    await waitFor(() => api.getDisplayedRowCount() === 1);
    expect(api.getColumnFilterModel("make")).toEqual({
      filterType: "text",
      type: "equals",
      filter: "Porsche",
    });
    await waitFor(() => display()?.textContent === "model=Porsche");
    expect(display()).toBe(element);
    expect(runs).toBe(1);

    grid.unmount();
  });
});

describe("CellEditorComponentProxy (no portal — T3.8 wires it into cellComp)", () => {
  it("tracks value/initialValue, resolves the instance via setRef, attaches optional methods", async () => {
    const refreshProps = vi.fn();
    const params = { value: 1 } as unknown as ICellEditorParams;
    const proxy = new CellEditorComponentProxy(params, refreshProps);

    let props = proxy.getProps();
    expect(props.initialValue).toBe(1);
    expect(props.value).toBe(1);
    expect(proxy.getValue()).toBe(1);

    props.onValueChange(2);
    expect(refreshProps).toHaveBeenCalledTimes(1);
    expect(proxy.getValue()).toBe(2);
    props = proxy.getProps();
    expect(props.value).toBe(2);
    expect(props.initialValue).toBe(1);

    const isCancelAfterEnd = vi.fn().mockReturnValue(true);
    proxy.setMethods({ isCancelAfterEnd });
    expect((proxy as unknown as { isCancelAfterEnd: () => boolean }).isCancelAfterEnd()).toBe(true);

    const handle = { focusIn: () => {} };
    proxy.setRef(handle);
    const instance = await agPromiseToPromise(proxy.getInstance());
    expect(instance).toBe(handle);

    proxy.refresh({ value: 3 } as unknown as ICellEditorParams);
    expect(refreshProps).toHaveBeenCalledTimes(2);
    // refresh swaps the source params: initialValue now reflects the new edit session params
    expect(proxy.getProps().initialValue).toBe(3);
  });
});

describe("DateComponentWrapper (jsdom)", () => {
  const dateType: ComponentType = { name: "dateComponent" };
  const d1 = new Date(2024, 0, 2);

  it("implements IDate over pushed date; onDateChange notifies the grid", async () => {
    const portalManager = newHostedManager();
    const onDateChanged = vi.fn();
    const captured: { onDateChange?: (date: Date | null) => void } = {};
    let sawOnDateChanged: unknown = "unset";
    const Comp: UserSolidComponent = (props) => {
      captured.onDateChange = untrack(() => props.onDateChange);
      sawOnDateChanged = untrack(() => props.onDateChanged);
      useGridDate({ setInputPlaceholder: () => {} });
      return <div class="cd">{`date=${props.date ? props.date.toISOString() : "none"}`}</div>;
    };
    const wrapper = new DateComponentWrapper(Comp, portalManager, dateType);
    await agPromiseToPromise(wrapper.init({ onDateChanged } as unknown as IDateParams));

    // grid-internal callback stripped from the pushed props
    expect(sawOnDateChanged).toBeUndefined();
    expect(wrapper.getDate()).toBeNull();

    wrapper.setDate(d1);
    expect(wrapper.getDate()).toBe(d1);
    await waitFor(() => wrapper.getGui().textContent === `date=${d1.toISOString()}`);
    expect(onDateChanged).not.toHaveBeenCalled();

    captured.onDateChange!(null);
    expect(wrapper.getDate()).toBeNull();
    expect(onDateChanged).toHaveBeenCalledTimes(1);

    // optional method attached from the hook
    expect(
      (wrapper as unknown as { setInputPlaceholder: (p: string) => void }).setInputPlaceholder,
    ).toBeTypeOf("function");

    wrapper.destroy();
  });
});

describe("simple refresh wrappers (jsdom)", () => {
  it("CustomOverlayComponentWrapper pushes refreshed params without remount", async () => {
    const portalManager = newHostedManager();
    let runs = 0;
    const Comp: UserSolidComponent = (props) => {
      runs++;
      return <div class="ov">{`v=${props.value}`}</div>;
    };
    const wrapper = new CustomOverlayComponentWrapper(Comp, portalManager, {
      name: "loadingOverlayComponent",
    });
    await agPromiseToPromise(wrapper.init({ value: 1 } as unknown as IOverlayParams));
    const elementBefore = wrapper.getRootElement();
    wrapper.refresh({ value: 2 } as unknown as IOverlayParams);
    await waitFor(() => wrapper.getGui().textContent === "v=2");
    expect(wrapper.getRootElement()).toBe(elementBefore);
    expect(runs).toBe(1);
    wrapper.destroy();
  });

  it("StatusPanelComponentWrapper.refresh returns true and pushes params (enterprise slot, mocked type)", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => <div class="sp">{`v=${props.value}`}</div>;
    const wrapper = new StatusPanelComponentWrapper(Comp, portalManager, { name: "statusPanel" });
    await agPromiseToPromise(wrapper.init({ value: "a" } as unknown as IStatusPanelParams));
    expect(wrapper.refresh({ value: "b" } as unknown as IStatusPanelParams)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "v=b");
    wrapper.destroy();
  });

  it("CellRendererComponentWrapper.refresh returns true and pushes params", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => <div class="cr">{`v=${props.value}`}</div>;
    const wrapper = new CellRendererComponentWrapper(Comp, portalManager, {
      name: "cellRenderer",
      supportsJsFunction: true,
    });
    await agPromiseToPromise(wrapper.init({ value: 1 } as never));
    expect(wrapper.refresh({ value: 2 } as never)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "v=2");
    wrapper.destroy();
  });

  it("ColumnSelectionLabelRendererComponentWrapper.refresh returns true and pushes params", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => <div class="csl">{`v=${props.displayName}`}</div>;
    const wrapper = new ColumnSelectionLabelRendererComponentWrapper(Comp, portalManager, {
      name: "columnLabelRenderer",
    });
    await agPromiseToPromise(wrapper.init({ displayName: "A" } as never));
    expect(wrapper.refresh({ displayName: "B" } as never)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "v=B");
    wrapper.destroy();
  });

  it("InnerHeaderComponentWrapper.refresh returns true and pushes params", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => <div class="ih">{`v=${props.displayName}`}</div>;
    const wrapper = new InnerHeaderComponentWrapper(Comp, portalManager, {
      name: "innerHeaderComponent",
    });
    await agPromiseToPromise(wrapper.init({ displayName: "A" } as never));
    expect(wrapper.refresh({ displayName: "B" } as never)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "v=B");
    wrapper.destroy();
  });

  it("DragAndDropImageComponentWrapper pushes label/icon/shake", async () => {
    const portalManager = newHostedManager();
    const Comp: UserSolidComponent = (props) => (
      <div class="dnd">{`${props.label}|${props.icon}|${props.shake}`}</div>
    );
    const wrapper = new DragAndDropImageComponentWrapper(Comp, portalManager, {
      name: "dragAndDropImageComponent",
    });
    await agPromiseToPromise(wrapper.init({} as never));
    expect(wrapper.getGui().textContent).toBe("|null|false");

    wrapper.setLabel("drag me");
    await waitFor(() => wrapper.getGui().textContent === "drag me|null|false");
    wrapper.setIcon("pinned", true);
    await waitFor(() => wrapper.getGui().textContent === "drag me|pinned|true");
    wrapper.destroy();
  });
});

describe("ToolPanelComponentWrapper (jsdom, enterprise slot, mocked type)", () => {
  it("syncs state through onStateChange → getState + onStateUpdated", async () => {
    const portalManager = newHostedManager();
    const onStateUpdated = vi.fn();
    const captured: { onStateChange?: (state: unknown) => void } = {};
    const Comp: UserSolidComponent = (props) => {
      captured.onStateChange = untrack(() => props.onStateChange);
      return <div class="tp">{`state=${props.state ?? "none"}`}</div>;
    };
    const wrapper = new ToolPanelComponentWrapper(Comp, portalManager, { name: "toolPanel" });
    await agPromiseToPromise(wrapper.init({ onStateUpdated } as unknown as IToolPanelParams));

    expect(wrapper.getState()).toBeUndefined();
    captured.onStateChange!("expanded");
    expect(wrapper.getState()).toBe("expanded");
    expect(onStateUpdated).toHaveBeenCalledTimes(1);
    await waitFor(() => wrapper.getGui().textContent === "state=expanded");

    expect(wrapper.refresh({ onStateUpdated } as unknown as IToolPanelParams)).toBe(true);
    wrapper.destroy();
  });

  it("applies params.initialState on init/restore but keeps reported state across refreshToolPanel", async () => {
    const portalManager = newHostedManager();
    const onStateUpdated = vi.fn();
    const captured: { onStateChange?: (state: unknown) => void } = {};
    const Comp: UserSolidComponent = (props) => {
      captured.onStateChange = untrack(() => props.onStateChange);
      return <div class="tp">{`state=${props.state ?? "none"}`}</div>;
    };
    const wrapper = new ToolPanelComponentWrapper(Comp, portalManager, { name: "toolPanel" });
    const initParams = { onStateUpdated, initialState: "restored" } as unknown as IToolPanelParams;
    await agPromiseToPromise(wrapper.init(initParams));
    expect(wrapper.getState()).toBe("restored");
    expect(wrapper.getGui().textContent).toBe("state=restored");

    captured.onStateChange!("expanded");
    // api.refreshToolPanel() re-presents the applied params: reported state survives
    expect(wrapper.refresh(initParams)).toBe(true);
    expect(wrapper.getState()).toBe("expanded");

    // a restore hands over fresh params: their initialState wins
    const restoreParams = {
      onStateUpdated,
      initialState: "restored",
    } as unknown as IToolPanelParams;
    expect(wrapper.refresh(restoreParams)).toBe(true);
    expect(wrapper.getState()).toBe("restored");
    await waitFor(() => wrapper.getGui().textContent === "state=restored");

    // fresh params without initialState leave the state alone
    captured.onStateChange!("collapsed");
    expect(wrapper.refresh({ onStateUpdated } as unknown as IToolPanelParams)).toBe(true);
    expect(wrapper.getState()).toBe("collapsed");
    wrapper.destroy();
  });
});

describe("MenuItemComponentWrapper (jsdom, enterprise slot, mocked type)", () => {
  it("pushes active/expanded; onActiveChange(true) notifies onItemActivated after props applied", async () => {
    const portalManager = newHostedManager();
    const onItemActivated = vi.fn();
    const select = vi.fn();
    const captured: { onActiveChange?: (active: boolean) => void } = {};
    let sawOnItemActivated: unknown = "unset";
    const Comp: UserSolidComponent = (props) => {
      captured.onActiveChange = untrack(() => props.onActiveChange);
      sawOnItemActivated = untrack(() => props.onItemActivated);
      useGridMenuItem({ configureDefaults: () => true, select });
      return <div class="mi">{`${props.active}|${props.expanded}`}</div>;
    };
    const wrapper = new MenuItemComponentWrapper(Comp, portalManager, { name: "menuItem" });
    await agPromiseToPromise(wrapper.init({ onItemActivated } as unknown as IMenuItemParams));

    expect(sawOnItemActivated).toBeUndefined();
    expect(wrapper.getGui().textContent).toBe("false|false");

    wrapper.setActive(true);
    await waitFor(() => wrapper.getGui().textContent === "true|false");
    expect(onItemActivated).not.toHaveBeenCalled();

    wrapper.setExpanded(true);
    await waitFor(() => wrapper.getGui().textContent === "true|true");

    captured.onActiveChange!(true);
    await waitFor(() => onItemActivated.mock.calls.length === 1);

    // hook-registered optional methods exposed to the grid core
    (wrapper as unknown as { select: () => void }).select();
    expect(select).toHaveBeenCalledTimes(1);
    expect((wrapper as unknown as { configureDefaults: () => boolean }).configureDefaults()).toBe(
      true,
    );

    wrapper.destroy();
  });
});

// SolidFrameworkComponentWrapper slot routing, observed through the grid. Slots whose routing a
// browser test already pins end to end are not repeated: filter (reactiveWrappers.browser —
// getInstance yields the user handle, only FilterComponentWrapper has it) and dateComponent
// (reactiveWrappers.browser — agDateColumnFilter filters through DateComponentWrapper's
// getDate/setDate, which the plain SolidComponent fallback lacks). Routing with no observable
// in a community grid: floatingFilterComponent (HeaderFilterCellComp renders Solid floating
// filters inline through the proxies, bypassing this switch), innerHeaderComponent (the
// default header comp is recreated, never refreshed, on header changes — as in vanilla),
// dragAndDropImageComponent (needs a real drag), and the enterprise/JS-internal slots
// (statusPanel, toolPanel, menuItem, columnLabelRenderer, cellRenderer) — those keep the
// wrapper-class tests above.
describe("SolidFrameworkComponentWrapper slot routing (jsdom grid)", () => {
  // only the reactive CustomOverlayComponentWrapper implements refresh — the plain SolidComponent
  // fallback suppresses it for overlays, so a params change would leave the overlay stale
  it.each([
    {
      slot: "loadingOverlayComponent",
      paramsKey: "loadingOverlayComponentParams",
      shownBy: { loading: true, rowData: carRows() },
      overlayType: "loading",
    },
    {
      slot: "noRowsOverlayComponent",
      paramsKey: "noRowsOverlayComponentParams",
      shownBy: { rowData: [] },
      overlayType: "noRows",
    },
    // 36.3 slots: one component for every provided overlay type, and the custom active overlay
    {
      slot: "overlayComponent",
      paramsKey: "overlayComponentParams",
      shownBy: { rowData: [] },
      overlayType: "noRows",
    },
    {
      slot: "activeOverlay",
      paramsKey: "activeOverlayParams",
      shownBy: { rowData: carRows() },
      overlayType: "custom",
    },
  ])(
    "$slot renders and $paramsKey changes refresh the live overlay (no remount)",
    async ({ slot, paramsKey, shownBy, overlayType }) => {
      const [label, setLabel] = createSignal("first");
      let runs = 0;
      const SolidOverlay = (props: CustomOverlayProps<CarRow> & { label: string }) => {
        runs++;
        return <div class="unit-overlay">{`${props.overlayType ?? "custom"}:${props.label}`}</div>;
      };
      const grid = mountGrid({
        columnDefs: [{ field: "make" }],
        ...shownBy,
        [slot]: SolidOverlay,
        get [paramsKey]() {
          return { label: label() };
        },
      });
      const overlay = () => grid.container.querySelector(".unit-overlay");
      await waitFor(() => overlay()?.textContent === `${overlayType}:first`);
      const element = overlay();

      setLabel("second");
      await waitFor(() => overlay()?.textContent === `${overlayType}:second`);
      expect(overlay()).toBe(element);
      expect(runs).toBe(1);

      grid.unmount();
    },
  );

  it("enableFilterHandlers: a Solid filter gets the applied model pushed live (no remount) and its onModelChange filters rows via the colDef doesFilterPass", async () => {
    let runs = 0;
    const SolidFilterDisplay = (props: CustomFilterDisplayProps<CarRow, unknown, string>) => {
      runs++;
      return (
        <button class="unit-filter-display" onClick={() => props.onModelChange("Ford")}>
          {`model=${props.model ?? "none"}`}
        </button>
      );
    };
    const grid = mountGrid({
      // jsdom has no offsetParent: popup positioning needs the body as the popup parent
      popupParent: document.body,
      enableFilterHandlers: true,
      columnDefs: [
        {
          field: "make",
          filter: {
            component: SolidFilterDisplay,
            doesFilterPass: ({ model, data }: { model: string; data: CarRow }) =>
              data.make === model,
          },
        },
        { field: "price" },
      ],
      rowData: carRows(),
    });
    await waitFor(() => grid.api() != null);
    const api = grid.api()!;
    api.showColumnFilter("make");
    const display = () => document.querySelector<HTMLButtonElement>(".unit-filter-display");
    await waitFor(() => display() != null);
    const element = display()!;
    expect(element.textContent).toBe("model=none");

    await api.setColumnFilterModel("make", "Toyota");
    api.onFilterChanged();
    await waitFor(() => display()?.textContent === "model=Toyota");
    expect(api.getDisplayedRowCount()).toBe(1);

    element.click();
    await waitFor(() => api.getColumnFilterModel("make") === "Ford");
    await waitFor(
      () => api.getDisplayedRowCount() === 1 && display()?.textContent === "model=Ford",
    );
    expect(api.getDisplayedRowAtIndex(0)!.data!.make).toBe("Ford");
    expect(display()).toBe(element);
    expect(runs).toBe(1);

    grid.unmount();
  });

  it("reactiveCustomComponents=false warns #231 for the grid, and a Solid filter still works through its props.ref handle", async () => {
    vi.mocked(_warnForGrid).mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let model: { value: string } | null = null;
    const handle: IFilter = {
      doesFilterPass: ({ data }) => model == null || (data as CarRow).make === model.value,
      isFilterActive: () => model != null,
      getModel: () => model,
      setModel: (next: { value: string } | null) => {
        model = next;
      },
    };
    const LegacyFilter = (props: { ref: (instance: IFilter) => void }) => {
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref(handle);
      return <div>legacy</div>;
    };
    const grid = mountGrid({
      reactiveCustomComponents: false,
      columnDefs: [{ field: "make", filter: LegacyFilter }, { field: "price" }],
      rowData: carRows(),
    });
    await waitFor(() => grid.api() != null);
    const api = grid.api()!;

    // the fallback SolidComponent hands the grid the comp's own handle as the filter instance
    expect(await api.getColumnFilterInstance("make")).toBe(handle);
    expect(_warnForGrid).toHaveBeenCalledWith(api.getGridId(), 231);

    // and the grid filters through it
    await api.setColumnFilterModel("make", { value: "Ford" });
    api.onFilterChanged();
    await waitFor(() => api.getDisplayedRowCount() === 1);
    expect(api.getDisplayedRowAtIndex(0)!.data!.make).toBe("Ford");

    warnSpy.mockRestore();
    grid.unmount();
  });
});
