import { render } from "@solidjs/testing-library";
import type { ColDef, GridParams, Module } from "ag-grid-community";
import {
  AllCommunityModule,
  ClientSideRowModelModule,
  getGridApi,
  GridCoreCreator,
  InfiniteRowModelModule,
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

/** Spies on GridCoreCreator.create to capture the GridParams handed to the core. */
const captureGridParams = () => {
  const captured: GridParams[] = [];
  const original = GridCoreCreator.prototype.create;
  vi.spyOn(GridCoreCreator.prototype, "create").mockImplementation(function (
    this: GridCoreCreator,
    ...args: Parameters<typeof original>
  ) {
    captured.push(args[5] as GridParams);
    return original.apply(this, args);
  });
  return captured;
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

  it("merges the modules prop with provider modules (prop first) and both grids share provider modules", async () => {
    const captured = captureGridParams();

    const { container } = render(() => (
      <AgGridProvider modules={[AllCommunityModule]}>
        <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
        <AgGridSolid
          modules={[ClientSideRowModelModule]}
          columnDefs={columnDefs}
          rowData={rowData}
        />
      </AgGridProvider>
    ));
    await settle();

    expect(captured).toHaveLength(2);
    // sibling 1: provider modules only
    expect(captured[0]!.modules).toEqual([AllCommunityModule]);
    // sibling 2: props.modules first, then provider modules (parity with React's merge order)
    expect(captured[1]!.modules).toEqual([ClientSideRowModelModule, AllCommunityModule]);

    // both siblings actually booted
    const outers = container.querySelectorAll(".ag-root-wrapper");
    expect(outers).toHaveLength(2);
  });

  it("nested providers accumulate parent + own modules (parent first)", async () => {
    const captured = captureGridParams();

    render(() => (
      <AgGridProvider modules={[ClientSideRowModelModule]}>
        <AgGridProvider modules={[AllCommunityModule]}>
          <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
        </AgGridProvider>
      </AgGridProvider>
    ));
    await settle();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.modules).toEqual([ClientSideRowModelModule, AllCommunityModule]);
  });

  it("passes usesAgGridProvider to the framework overrides (true under provider, false without)", async () => {
    const captured = captureGridParams();

    // sequential renders keep the capture order deterministic (sibling onSettled order is not)
    render(() => (
      <AgGridProvider modules={[AllCommunityModule]}>
        <AgGridSolid columnDefs={columnDefs} rowData={rowData} />
      </AgGridProvider>
    ));
    await settle();
    render(() => (
      <AgGridSolid modules={[AllCommunityModule]} columnDefs={columnDefs} rowData={rowData} />
    ));
    await settle();

    expect(captured).toHaveLength(2);
    expect(captured[0]!.frameworkOverrides!.usesAgGridProvider).toBe(true);
    expect(captured[1]!.frameworkOverrides!.usesAgGridProvider).toBe(false);
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
});
