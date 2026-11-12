import { render } from "@solidjs/testing-library";
import type { ColDef, GridApi, IDatasource, Module } from "ag-grid-community";
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  CsvExportModule,
  getGridApi,
  InfiniteRowModelModule,
  ValidationModule,
} from "ag-grid-community";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgGridSolid, { AgGridProvider } from "../../src/index";

// IMPORTANT: this file must never call ModuleRegistry.registerModules — the whole point is
// proving grids boot from provider-supplied modules alone (vitest isolates module graphs per
// test file, so registrations from other files don't leak in here).

interface CarRow {
  make: string;
  price: number;
}

const columnDefs: ColDef<CarRow>[] = [{ field: "make" }, { field: "price" }];
const rowData: CarRow[] = [{ make: "Toyota", price: 35000 }];

// grid creation runs in onSettled + GridComp mounts on the following flush
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// AG Grid batches missing-module reports and logs them 50ms after the first one
const flushMissingModuleReports = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

/** Infinite-model datasource over `rowData` — only loads if InfiniteRowModelModule is present. */
const datasource: IDatasource = {
  getRows: (p) => p.successCallback(rowData.slice(p.startRow, p.endRow), rowData.length),
};

/** The api of the grid whose outermost div is the first child of `selector`'s element. */
const apiIn = (container: HTMLElement, selector: string): GridApi<CarRow> | undefined =>
  getGridApi(container.querySelector(selector)!.firstElementChild as HTMLDivElement);

/** Waits until the grid under `selector` renders the datasource's row (boot + block load). */
const waitForDatasourceRow = async (container: HTMLElement, selector: string) => {
  const start = Date.now();
  while (container.querySelector(`${selector} .ag-cell[col-id="make"]`)?.textContent !== "Toyota") {
    if (Date.now() - start > 2000) {
      throw new Error(`no datasource row rendered in ${selector}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

describe("AgGridProvider (jsdom)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // NOTE: v36's CommunityCoreModule (auto-registered per grid) dependsOn ClientSideRowModel,
  // so a bare clientSide grid boots with zero user modules. Module-dependence is therefore
  // exercised with rowModelType="infinite", which IS gated on InfiniteRowModelModule.
  // runs FIRST: later tests hand real modules to grid cores, and this test's premise is that
  // nothing has been registered at all
  it("grid needing an unregistered module surfaces AG Grid's missing-module error, not a wrapper crash", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(() => (
      <AgGridSolid rowModelType="infinite" columnDefs={columnDefs} />
    ));
    await settle();

    // the wrapper shell rendered (no crash) ...
    expect(container.firstElementChild).toBeInstanceOf(HTMLDivElement);
    // ... the core refused to boot (no api) ...
    expect(getGridApi(container.firstElementChild as HTMLDivElement)).toBeUndefined();
    // ... and reported its standard missing-module guidance (error #200)
    const allErrors = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(allErrors).toMatch(/error #200|Missing module/);
  });

  it("boots a module-gated grid from modules supplied ONLY by the provider", async () => {
    const rows = [{ make: "Toyota", price: 35000 }];
    const { container } = render(() => (
      <AgGridProvider modules={[InfiniteRowModelModule]}>
        <AgGridSolid
          rowModelType="infinite"
          columnDefs={columnDefs}
          datasource={{
            getRows: (p) => p.successCallback(rows.slice(p.startRow, p.endRow), rows.length),
          }}
        />
      </AgGridProvider>
    ));
    await settle();

    const outermost = container.firstElementChild as HTMLDivElement;
    expect(outermost.querySelector(".ag-root-wrapper")).not.toBeNull();
    const api = getGridApi(outermost);
    // boot succeeded — only possible because InfiniteRowModelModule arrived via the provider
    expect(api).toBeDefined();
    expect(api!.isDestroyed()).toBe(false);
  });

  // capabilities (not module arrays) are asserted: AG Grid dedupes and registers modules per
  // grid, so merge order has no observable effect — what matters is that each grid ends up
  // with every source's modules and no one else's
  it("a grid gets its modules prop on top of the provider's; a sibling without the prop gets only the provider's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(() => (
      <AgGridProvider modules={[InfiniteRowModelModule]}>
        {/* the prop grid comes first: a merge that leaked into the shared provider list would
            reach the sibling booting after it */}
        <div class="with-prop">
          <AgGridSolid
            modules={[CsvExportModule]}
            rowModelType="infinite"
            columnDefs={columnDefs}
            datasource={datasource}
          />
        </div>
        <div class="provider-only">
          <AgGridSolid rowModelType="infinite" columnDefs={columnDefs} datasource={datasource} />
        </div>
      </AgGridProvider>
    ));

    // both siblings boot the infinite row model and load from the datasource: provider modules
    await waitForDatasourceRow(container, ".with-prop");
    await waitForDatasourceRow(container, ".provider-only");

    // the prop's CsvExportModule works on its own grid ...
    expect(apiIn(container, ".with-prop")!.getDataAsCsv()).toContain('"Toyota","35000"');
    // ... and stays scoped to it: the provider-only sibling has no CSV export
    expect(apiIn(container, ".provider-only")!.getDataAsCsv()).toBeUndefined();
    // drain AG Grid's batched missing-module report while console.error is still muted
    await flushMissingModuleReports();
  });

  it("nested providers accumulate parent + own modules", async () => {
    const { container } = render(() => (
      <AgGridProvider modules={[InfiniteRowModelModule]}>
        <AgGridProvider modules={[CsvExportModule]}>
          <div class="nested">
            <AgGridSolid rowModelType="infinite" columnDefs={columnDefs} datasource={datasource} />
          </div>
        </AgGridProvider>
      </AgGridProvider>
    ));

    // the parent's InfiniteRowModelModule boots the row model and loads the datasource ...
    await waitForDatasourceRow(container, ".nested");
    // ... and the inner provider's CsvExportModule exports it
    expect(apiIn(container, ".nested")!.getDataAsCsv()).toContain('"Toyota","35000"');
  });

  it("missing-module guidance shows the AgGridProvider form under a provider and ModuleRegistry without one", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // ValidationModule makes AG Grid log the full guidance text instead of a docs link
    const modules = [ClientSideRowModelModule, ValidationModule];
    const { container } = render(() => (
      <>
        <div class="under-provider">
          <AgGridProvider modules={modules}>
            <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
          </AgGridProvider>
        </div>
        <div class="standalone">
          <AgGridSolid modules={modules} columnDefs={columnDefs} rowData={rowData} />
        </div>
      </>
    ));
    await settle();

    // CsvExportModule is registered for neither grid
    const guidanceFor = async (api: GridApi<CarRow>) => {
      errorSpy.mockClear();
      expect(api.getDataAsCsv()).toBeUndefined();
      await flushMissingModuleReports();
      const logged = errorSpy.mock.calls.flat().join("\n");
      expect(logged).toContain(
        `CsvExportModule\` is not registered for gridId: ${api.getGridId()}`,
      );
      return logged;
    };

    const providerGuidance = await guidanceFor(apiIn(container, ".under-provider")!);
    expect(providerGuidance).toContain("<AgGridProvider modules={modules}>");
    expect(providerGuidance).not.toContain("ModuleRegistry.registerModules");

    const standaloneGuidance = await guidanceFor(apiIn(container, ".standalone")!);
    expect(standaloneGuidance).toContain("ModuleRegistry.registerModules([ CsvExportModule ]);");
    expect(standaloneGuidance).not.toContain("<AgGridProvider");
  });

  it("provider licenseKey reaches _findEnterpriseCoreModule().setLicenseKey over the MERGED module list", async () => {
    // fake enterprise core: any module exposing setLicenseKey implements _ModuleWithLicenseManager
    const setLicenseKey = vi.fn();
    const fakeEnterpriseCore = {
      moduleName: "FakeEnterpriseCoreModule",
      version: "36.0.1",
      setLicenseKey,
    } as unknown as Module;

    render(() => (
      <AgGridProvider modules={[AllCommunityModule]} licenseKey="TEST_LICENSE_KEY">
        {/* enterprise module arrives via the PROP, key via the provider — the lookup must span both */}
        <AgGridSolid modules={[fakeEnterpriseCore]} columnDefs={columnDefs} rowData={rowData} />
      </AgGridProvider>
    ));
    await settle();

    expect(setLicenseKey).toHaveBeenCalledWith("TEST_LICENSE_KEY");
  });

  it("nested provider without a licenseKey inherits the parent's", async () => {
    const setLicenseKey = vi.fn();
    const fakeEnterpriseCore = {
      moduleName: "FakeEnterpriseCoreModule",
      version: "36.0.1",
      setLicenseKey,
    } as unknown as Module;

    render(() => (
      <AgGridProvider modules={[AllCommunityModule]} licenseKey="PARENT_KEY">
        <AgGridProvider modules={[fakeEnterpriseCore]}>
          <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
        </AgGridProvider>
      </AgGridProvider>
    ));
    await settle();

    expect(setLicenseKey).toHaveBeenCalledWith("PARENT_KEY");
  });

  it("nested provider's own licenseKey takes precedence over the parent's", async () => {
    const setLicenseKey = vi.fn();
    const fakeEnterpriseCore = {
      moduleName: "FakeEnterpriseCoreModule",
      version: "36.0.1",
      setLicenseKey,
    } as unknown as Module;

    render(() => (
      <AgGridProvider modules={[AllCommunityModule]} licenseKey="PARENT_KEY">
        <AgGridProvider modules={[fakeEnterpriseCore]} licenseKey="CHILD_KEY">
          <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
        </AgGridProvider>
      </AgGridProvider>
    ));
    await settle();

    // set once, with the closest provider's key — the parent's never reaches the license manager
    expect(setLicenseKey.mock.calls).toEqual([["CHILD_KEY"]]);
  });
});
