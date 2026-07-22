// T4 ship check: legacy CSS-file theming still works. v33+ made the Theming API the
// default; users opting back into CSS-file themes set `theme="legacy"` on the grid and put
// the theme class (e.g. ag-theme-quartz) on a parent element. This test imports the real
// CSS and verifies the themed grid renders with the theme's styles actually applied.
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

import { render } from "@solidjs/testing-library";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type CarRow = { readonly make: string; readonly price: number };

const rowData: CarRow[] = [
  { make: "Toyota", price: 35000 },
  { make: "Ford", price: 32000 },
  { make: "Porsche", price: 72000 },
];

describe("legacy CSS theming (theme='legacy' + ag-theme-quartz class)", () => {
  it("renders the grid with the quartz CSS theme applied", async () => {
    const { container, unmount } = render(() => (
      <div class="ag-theme-quartz" style={{ height: "300px", width: "500px" }}>
        <AgGridSolid
          theme="legacy"
          columnDefs={[{ field: "make" }, { field: "price" }]}
          rowData={rowData}
        />
      </div>
    ));

    // grid boots and renders rows
    await vi.waitFor(() => {
      expect(container.querySelectorAll(".ag-row").length).toBe(3);
    });
    expect(container.textContent).toContain("Porsche");

    // the root wrapper exists inside the themed element
    const rootWrapper = container.querySelector<HTMLElement>(".ag-root-wrapper");
    expect(rootWrapper).not.toBeNull();

    // the quartz stylesheet is genuinely applied: its CSS custom properties resolve on the
    // grid root (they only exist when ag-theme-quartz.css matched the ancestor class)
    const styles = getComputedStyle(rootWrapper!);
    expect(styles.getPropertyValue("--ag-active-color").trim()).not.toBe("");
    expect(styles.getPropertyValue("--ag-row-height").trim()).not.toBe("");

    unmount();
  });
});
