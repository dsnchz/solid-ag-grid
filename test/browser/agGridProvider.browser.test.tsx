import { render } from "@solidjs/testing-library";
import { getGridApi, InfiniteRowModelModule } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid, { AgGridProvider } from "../../src/index";

// NO ModuleRegistry.registerModules here: the point of this file is that modules arrive
// exclusively through <AgGridProvider> (vitest isolates test files, so registrations from
// other browser test files don't leak in). rowModelType="infinite" is used because it is
// genuinely gated on InfiniteRowModelModule — v36's CommunityCoreModule already bundles the
// clientSide row model, so a clientSide grid would boot even without the provider.

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe("AgGridProvider (browser)", () => {
  it("renders a working module-gated grid whose modules come ONLY from the provider", async () => {
    // guards the accessor-carrying context design: a plain-value context provider would trip
    // STRICT_READ_UNTRACKED reading the merged-modules memo in the provider's value attribute
    const errorSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");
    const rows = [
      { make: "Toyota", price: 35000 },
      { make: "Ford", price: 32000 },
    ];
    const { container } = render(() => (
      <AgGridProvider modules={[InfiniteRowModelModule]}>
        <AgGridSolid
          containerStyle={{ height: "300px" }}
          rowModelType="infinite"
          columnDefs={[{ field: "make" }, { field: "price" }]}
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
    expect(api).toBeDefined();
    expect(api!.isDestroyed()).toBe(false);

    // real header + cell content rendered, proving the row model module was picked up
    const headerTexts = Array.from(outermost.querySelectorAll(".ag-header-cell-text")).map(
      (el) => el.textContent,
    );
    expect(headerTexts).toEqual(["Make", "Price"]);
    const cellTexts = Array.from(outermost.querySelectorAll(".ag-cell")).map(
      (el) => el.textContent,
    );
    expect(cellTexts).toContain("Toyota");
    expect(cellTexts).toContain("35000");

    // no Solid 2.0 reactivity diagnostics from the provider/context plumbing
    const diagnostics = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => call.join(" "))
      .filter((msg) =>
        /PENDING_ASYNC|REACTIVE_WRITE_IN_OWNED_SCOPE|REACTIVITY_HALTED|NotReadyError|STRICT_READ/.test(
          msg,
        ),
      );
    expect(diagnostics).toEqual([]);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
