// T3.7: reactive custom-component wrappers/proxies driven directly against the real
// GridPortals render loop with mocked componentTypes/params — no grid core involved (the
// browser suite covers the end-to-end parity oracle; enterprise-only slots — statusPanel,
// toolPanel, menuItem — are unit-tested here only, per the task's out-of-scope note).
import { render } from "@solidjs/testing-library";
import type {
  ComponentType,
  FilterDisplayParams,
  FloatingFilterDisplayParams,
  ICellEditorParams,
  IDateParams,
  IDoesFilterPassParams,
  IFilterParams,
  IFloatingFilterParams,
  IMenuItemParams,
  IOverlayParams,
  IStatusPanelParams,
  IToolPanelParams,
} from "ag-grid-community";
import { untrack } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import GridPortals from "../../src/core/gridPortals";
import { PortalManager } from "../../src/core/portalManager";
import type { UserSolidComponent } from "../../src/core/solidComponent";
import { SolidComponent } from "../../src/core/solidComponent";
import { SolidFrameworkComponentWrapper } from "../../src/core/solidFrameworkComponentWrapper";
import { CellEditorComponentProxy } from "../../src/customComp/cellEditorComponentProxy";
import { CellRendererComponentWrapper } from "../../src/customComp/cellRendererComponentWrapper";
import { CustomComponentWrapper } from "../../src/customComp/customComponentWrapper";
import { CustomOverlayComponentWrapper } from "../../src/customComp/customOverlayComponentWrapper";
import { DateComponentWrapper } from "../../src/customComp/dateComponentWrapper";
import { DragAndDropImageComponentWrapper } from "../../src/customComp/dragAndDropImageComponentWrapper";
import { FilterComponentWrapper } from "../../src/customComp/filterComponentWrapper";
import { FilterDisplayComponentWrapper } from "../../src/customComp/filterDisplayComponentWrapper";
import { FloatingFilterComponentProxy } from "../../src/customComp/floatingFilterComponentProxy";
import { FloatingFilterComponentWrapper } from "../../src/customComp/floatingFilterComponentWrapper";
import { FloatingFilterDisplayComponentProxy } from "../../src/customComp/floatingFilterDisplayComponentProxy";
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
});

describe("FloatingFilterDisplayComponentProxy (no portal)", () => {
  it("getProps returns the params; refresh swaps them; setMethods attaches optional methods", () => {
    const refreshProps = vi.fn();
    const params = { model: "a" } as unknown as FloatingFilterDisplayParams;
    const proxy = new FloatingFilterDisplayComponentProxy(params, refreshProps);
    expect(proxy.getProps()).toBe(params);

    const next = { model: "b" } as unknown as FloatingFilterDisplayParams;
    proxy.refresh(next);
    expect(proxy.getProps()).toBe(next);
    expect(refreshProps).toHaveBeenCalledTimes(1);

    const afterGuiAttached = vi.fn();
    proxy.setMethods({ afterGuiAttached });
    (proxy as unknown as { afterGuiAttached: () => void }).afterGuiAttached();
    expect(afterGuiAttached).toHaveBeenCalledTimes(1);
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
      cellRenderer: true,
    });
    await agPromiseToPromise(wrapper.init({ value: 1 } as never));
    expect(wrapper.refresh({ value: 2 } as never)).toBe(true);
    await waitFor(() => wrapper.getGui().textContent === "v=2");
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

describe("SolidFrameworkComponentWrapper switch", () => {
  const createWrapperFor = (name: string, gridOptions: Record<string, unknown>) => {
    const portalManager = new PortalManager();
    const frameworkWrapper = new SolidFrameworkComponentWrapper(portalManager, gridOptions);
    const componentType: ComponentType = { name, cellRenderer: name === "cellRenderer" };
    return (
      frameworkWrapper as unknown as {
        createWrapper: (comp: unknown, type: ComponentType) => unknown;
      }
    ).createWrapper(() => <div />, componentType);
  };

  it("routes every reactive slot to its wrapper class", () => {
    const opts = { reactiveCustomComponents: true };
    expect(createWrapperFor("filter", opts)).toBeInstanceOf(FilterComponentWrapper);
    expect(createWrapperFor("floatingFilterComponent", opts)).toBeInstanceOf(
      FloatingFilterComponentWrapper,
    );
    expect(createWrapperFor("dateComponent", opts)).toBeInstanceOf(DateComponentWrapper);
    expect(createWrapperFor("dragAndDropImageComponent", opts)).toBeInstanceOf(
      DragAndDropImageComponentWrapper,
    );
    expect(createWrapperFor("loadingOverlayComponent", opts)).toBeInstanceOf(
      CustomOverlayComponentWrapper,
    );
    expect(createWrapperFor("noRowsOverlayComponent", opts)).toBeInstanceOf(
      CustomOverlayComponentWrapper,
    );
    expect(createWrapperFor("activeOverlay", opts)).toBeInstanceOf(CustomOverlayComponentWrapper);
    expect(createWrapperFor("statusPanel", opts)).toBeInstanceOf(StatusPanelComponentWrapper);
    expect(createWrapperFor("toolPanel", opts)).toBeInstanceOf(ToolPanelComponentWrapper);
    expect(createWrapperFor("menuItem", opts)).toBeInstanceOf(MenuItemComponentWrapper);
    expect(createWrapperFor("cellRenderer", opts)).toBeInstanceOf(CellRendererComponentWrapper);
    expect(createWrapperFor("innerHeaderComponent", opts)).toBeInstanceOf(
      InnerHeaderComponentWrapper,
    );
    // non-reactive slots stay plain SolidComponents
    const tooltip = createWrapperFor("tooltipComponent", opts);
    expect(tooltip).toBeInstanceOf(SolidComponent);
    expect(tooltip).not.toBeInstanceOf(CustomComponentWrapper);
  });

  it("enableFilterHandlers switches filter slots to the Display wrappers", () => {
    const opts = { reactiveCustomComponents: true, enableFilterHandlers: true };
    expect(createWrapperFor("filter", opts)).toBeInstanceOf(FilterDisplayComponentWrapper);
    expect(createWrapperFor("floatingFilterComponent", opts)).toBeInstanceOf(
      FloatingFilterDisplayComponentWrapper,
    );
  });

  it("reactiveCustomComponents=false falls back to SolidComponent and warns (deprecated path)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = createWrapperFor("filter", { reactiveCustomComponents: false });
    expect(wrapper).toBeInstanceOf(SolidComponent);
    expect(wrapper).not.toBeInstanceOf(CustomComponentWrapper);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
