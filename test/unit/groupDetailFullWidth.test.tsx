// T3.10 shell contract (jsdom). The group/detail renderer ctrls are ENTERPRISE dynamic beans
// (groupCellRendererCtrl / detailCellRendererCtrl), so the comps are driven here through mocked
// registries — structural coverage only; behavioral parity needs enterprise modules (T3.11
// trial decision). Full-width rows ARE community and get real-grid coverage (plus browser
// parity in test/browser/groupDetailFullWidth.browser.test.tsx).
import { render } from "@solidjs/testing-library";
import type {
  BeanCollection,
  GroupCellRendererParams,
  ICellRenderer,
  IDetailCellRenderer,
  IDetailCellRendererCtrl,
  IDetailCellRendererParams,
  IGroupCellRenderer,
  IGroupCellRendererCtrl,
} from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import DetailCellRenderer from "../../src/cellRenderer/detailCellRenderer";
import GroupCellRenderer from "../../src/cellRenderer/groupCellRenderer";
import { BeansContext } from "../../src/core/beansContext";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

/** Minimal fake BeanCollection: identity createBean/destroyBean + a stubbed registry. */
const makeFakeBeans = (dynamicBeans: { [name: string]: unknown }, gosValues: object = {}) => {
  const destroyed: unknown[] = [];
  const beans = {
    context: {
      isDestroyed: () => false,
      createBean: (bean: unknown) => bean,
      destroyBean: (bean: unknown) => {
        if (bean) {
          destroyed.push(bean);
        }
        return undefined;
      },
    },
    registry: {
      createDynamicBean: vi.fn((name: string, _optional: boolean) => dynamicBeans[name]),
    },
    gos: {
      get: (key: string) => (gosValues as { [key: string]: unknown })[key],
    },
    rowModel: {},
  };
  return { beans: beans as unknown as BeanCollection, destroyed };
};

describe("GroupCellRenderer (jsdom shell contract, mocked groupCellRendererCtrl)", () => {
  const setup = (params: Partial<GroupCellRendererParams> = {}) => {
    let compProxy!: IGroupCellRenderer;
    const ctrl: IGroupCellRendererCtrl & { init: ReturnType<typeof vi.fn> } = {
      init: vi.fn((comp: IGroupCellRenderer) => {
        compProxy = comp;
      }),
      destroy: vi.fn(),
      getCellAriaRole: () => "gridcell",
    };
    const { beans, destroyed } = makeFakeBeans({ groupCellRendererCtrl: ctrl });
    let handle: ICellRenderer | undefined;
    const result = render(() => (
      <BeansContext value={beans}>
        <GroupCellRenderer
          {...(params as GroupCellRendererParams)}
          ref={(h: ICellRenderer) => (handle = h)}
        />
      </BeansContext>
    ));
    return { ctrl, compProxy: () => compProxy, handle: () => handle, destroyed, ...result };
  };

  it("renders the skeleton, inits the ctrl with all elements + the comp class, and exposes refresh() === false", () => {
    const { container, ctrl, handle, unmount } = setup({ colDef: {} });

    const wrapper = container.querySelector<HTMLElement>(".ag-cell-wrapper")!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector(".ag-group-expanded")).not.toBeNull();
    expect(wrapper.querySelector(".ag-group-contracted")).not.toBeNull();
    expect(wrapper.querySelector(".ag-group-checkbox")).not.toBeNull();
    expect(wrapper.querySelector(".ag-group-value")).not.toBeNull();
    expect(wrapper.querySelector(".ag-group-child-count")).not.toBeNull();
    // hidden/invisible initial state, aria-hidden explicit "true" (React parity)
    expect(wrapper.querySelector(".ag-group-expanded")!.classList.contains("ag-hidden")).toBe(true);
    expect(wrapper.querySelector(".ag-group-contracted")!.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.querySelector(".ag-group-checkbox")!.classList.contains("ag-invisible")).toBe(
      true,
    );

    expect(ctrl.init).toHaveBeenCalledTimes(1);
    const [, eGui, eCheckbox, eExpanded, eContracted, compClass] = ctrl.init.mock.calls[0]!;
    expect(eGui).toBe(wrapper);
    expect(eCheckbox).toBe(wrapper.querySelector(".ag-group-checkbox"));
    expect(eExpanded).toBe(wrapper.querySelector(".ag-group-expanded"));
    expect(eContracted).toBe(wrapper.querySelector(".ag-group-contracted"));
    expect(compClass).toBe(GroupCellRenderer);
    // colDef present → role NOT set from the ctrl
    expect(wrapper.getAttribute("role")).toBeNull();

    // the imperative handle forces a new instance on grid refresh
    expect(handle()).toBeDefined();
    expect(handle()!.refresh!({} as never)).toBe(false);

    unmount();
  });

  it("sets the ctrl's aria role when there is no colDef (full-width group row)", () => {
    const { container, unmount } = setup({});
    expect(container.querySelector(".ag-cell-wrapper")!.getAttribute("role")).toBe("gridcell");
    unmount();
  });

  it("compProxy setters drive value / child count / expand-contract-checkbox visibility", () => {
    const { container, compProxy, unmount } = setup({ colDef: {} });
    const proxy = compProxy();

    proxy.setInnerRenderer(undefined, "Toyota");
    proxy.setChildCount("(3)");
    proxy.setExpandedDisplayed(true);
    proxy.setCheckboxVisible(true);
    proxy.setCheckboxSpacing(true);
    proxy.toggleCss("ag-row-group", true);
    flush();

    expect(container.querySelector(".ag-group-value")!.textContent).toBe("Toyota");
    expect(container.querySelector(".ag-group-child-count")!.textContent).toBe("(3)");
    const expanded = container.querySelector<HTMLElement>(".ag-group-expanded")!;
    expect(expanded.classList.contains("ag-hidden")).toBe(false);
    expect(expanded.getAttribute("aria-hidden")).toBe("false");
    const checkbox = container.querySelector<HTMLElement>(".ag-group-checkbox")!;
    expect(checkbox.classList.contains("ag-invisible")).toBe(false);
    expect(checkbox.classList.contains("ag-group-checkbox-spacing")).toBe(true);
    expect(checkbox.getAttribute("aria-hidden")).toBe("false");
    // root classes are applied imperatively (CssClassManager) alongside the static base class
    const wrapper = container.querySelector<HTMLElement>(".ag-cell-wrapper")!;
    expect(wrapper.classList.contains("ag-row-group")).toBe(true);

    proxy.setExpandedDisplayed(false);
    flush();
    expect(expanded.classList.contains("ag-hidden")).toBe(true);
    expect(expanded.getAttribute("aria-hidden")).toBe("true");

    unmount();
  });

  it("renders an inner framework (Solid) renderer via derived JSX and destroys the ctrl on unmount", () => {
    const { container, compProxy, ctrl, destroyed, unmount } = setup({ colDef: {} });
    const InnerComp = (props: { value?: string }) => (
      <em class="inner-fw">{props.value ?? "inner"}</em>
    );

    compProxy().setInnerRenderer(
      {
        componentFromFramework: true,
        componentClass: InnerComp,
        params: { value: "grouped!" },
      } as never,
      "ignored",
    );
    flush();

    const inner = container.querySelector(".ag-group-value .inner-fw");
    expect(inner).not.toBeNull();
    expect(inner!.textContent).toBe("grouped!");

    unmount();
    expect(destroyed).toContain(ctrl);
  });
});

describe("DetailCellRenderer (jsdom shell contract, mocked detailCellRendererCtrl)", () => {
  const setup = (paramsExtra: Partial<IDetailCellRendererParams> = {}, gosValues: object = {}) => {
    let compProxy!: IDetailCellRenderer;
    const registerDetailWithMaster = vi.fn();
    const ctrl: IDetailCellRendererCtrl = {
      init: vi.fn((comp: IDetailCellRenderer) => {
        compProxy = comp;
      }) as never,
      destroy: vi.fn(),
      refresh: vi.fn(() => true),
      registerDetailWithMaster,
    };
    const { beans, destroyed } = makeFakeBeans({ detailCellRendererCtrl: ctrl }, gosValues);
    let handle: { refresh(): boolean } | undefined;
    const params = {
      api: { getGridId: () => "master-grid" },
      node: { setRowHeight: vi.fn() },
      ...paramsExtra,
    } as unknown as IDetailCellRendererParams;
    const result = render(() => (
      <BeansContext value={beans}>
        <DetailCellRenderer {...params} ref={(h: { refresh(): boolean }) => (handle = h)} />
      </BeansContext>
    ));
    return {
      ctrl,
      compProxy: () => compProxy,
      handle: () => handle,
      registerDetailWithMaster,
      destroyed,
      ...result,
    };
  };

  it("renders ag-details-row, inits the ctrl, and routes the refresh handle to ctrl.refresh()", () => {
    const { container, ctrl, handle, unmount } = setup();

    const row = container.querySelector<HTMLElement>(".ag-details-row")!;
    expect(row).not.toBeNull();
    expect(ctrl.init).toHaveBeenCalledTimes(1);
    expect((ctrl.init as ReturnType<typeof vi.fn>).mock.calls[0]![0].getGui()).toBe(row);

    expect(handle()!.refresh()).toBe(true);
    expect(ctrl.refresh).toHaveBeenCalledTimes(1);

    unmount();
    expect((ctrl.destroy as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("setDetailGrid + setRowData mount a real nested AgGridSolid that registers with the master", async () => {
    const { container, compProxy, registerDetailWithMaster, unmount } = setup();

    compProxy().setDetailGrid({
      columnDefs: [{ field: "callId" }, { field: "duration" }],
    });
    compProxy().setRowData([
      { callId: 1, duration: 30 },
      { callId: 2, duration: 45 },
    ]);
    flush();

    // nested grid boots in its own onSettled and renders like any other grid
    await waitFor(() => container.querySelectorAll(".ag-details-row .ag-row").length >= 2);
    // the detail grid class lands on the nested grid's outermost div
    const detailGrid = container.querySelector<HTMLElement>(".ag-details-grid")!;
    expect(detailGrid).not.toBeNull();
    expect(detailGrid.querySelector(".ag-root")).not.toBeNull();
    // cell content from setRowData
    const texts = [...container.querySelectorAll('.ag-cell[col-id="callId"]')].map(
      (c) => c.textContent,
    );
    expect(texts).toEqual(["1", "2"]);

    // detail api handed back to the ctrl once the nested grid is ready
    await waitFor(() => registerDetailWithMaster.mock.calls.length > 0);
    const detailApi = registerDetailWithMaster.mock.calls[0]![0];
    expect(typeof detailApi.getDisplayedRowCount).toBe("function");
    expect(detailApi.getDisplayedRowCount()).toBe(2);

    unmount();
  });

  it("toggleDetailGridCss flows into the nested grid's class; toggleCss lands on the root imperatively", async () => {
    const { container, compProxy, unmount } = setup();
    compProxy().toggleCss("ag-details-row-auto-height", true);
    compProxy().setDetailGrid({ columnDefs: [{ field: "a" }] });
    compProxy().setRowData([{ a: 1 }]);
    compProxy().toggleDetailGridCss("ag-details-grid-auto-height", true);
    flush();

    const row = container.querySelector<HTMLElement>(".ag-details-row")!;
    expect(row.classList.contains("ag-details-row-auto-height")).toBe(true);
    await waitFor(() => container.querySelector(".ag-details-grid") != null);
    expect(
      container
        .querySelector<HTMLElement>(".ag-details-grid")!
        .classList.contains("ag-details-grid-auto-height"),
    ).toBe(true);

    unmount();
  });

  it("warns when a string template param is provided (not supported outside string-template frameworks)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = setup({ template: "<div>custom</div>" as never });
    // _warn(230) — the full "template is not supported" text is only resolved when a grid's
    // ValidationModule is live; outside a grid the core logs the warning id + docs link
    expect(warnSpy.mock.calls.some((call) => call.join(" ").includes("#230"))).toBe(true);
    warnSpy.mockRestore();
    unmount();
  });
});

describe("Full-width rows (jsdom, real community grid)", () => {
  it("renders a Solid fullWidthCellRenderer inside the ag-full-width-anchor, spanning instead of cells", async () => {
    const FullWidthRenderer = (props: { data?: { info?: string } }) => (
      <div class="my-full-width">FW: {props.data?.info}</div>
    );
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px", width: "600px" }}
        columnDefs={[{ field: "info" }]}
        rowData={[{ info: "normal" }, { info: "wide" }]}
        isFullWidthRow={(params) => params.rowNode.data?.info === "wide"}
        fullWidthCellRenderer={FullWidthRenderer}
      />
    ));

    await waitFor(() => container.querySelector(".my-full-width") != null);
    const fwRow = container.querySelector<HTMLElement>(".ag-full-width-row")!;
    expect(fwRow).not.toBeNull();
    const anchor = fwRow.querySelector<HTMLElement>(".ag-full-width-anchor")!;
    expect(anchor).not.toBeNull();
    expect(anchor.querySelector(".my-full-width")!.textContent).toBe("FW: wide");
    // full-width rows render no cell lanes
    expect(fwRow.querySelector(".ag-cell")).toBeNull();
    expect(fwRow.querySelector(".ag-grid-scrolling-cells")).toBeNull();
    // the normal row still renders cells
    expect(container.querySelectorAll(".ag-cell").length).toBeGreaterThan(0);

    unmount();
  });
});
