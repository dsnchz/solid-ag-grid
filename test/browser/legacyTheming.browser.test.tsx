// T4 ship check: legacy CSS-file theming still works. v33+ made the Theming API the
// default; users opting back into CSS-file themes set `theme="legacy"` on the grid and put
// the theme class (e.g. ag-theme-quartz) on a parent element. This test imports the real
// CSS and verifies `theme="legacy"` reaches the grid core: in legacy mode the core sizes rows
// from the theme CSS's --ag-row-height, so overriding that variable on the themed parent
// drives the rendered row height — the default Theming API mode does not read it.
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

import { render } from "@solidjs/testing-library";
import type { GridApi } from "ag-grid-community";
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

// off every theme's default grid-size multiple, so only the override can produce it
const ROW_HEIGHT_OVERRIDE = 61;

/** Mounts under the quartz CSS class with a --ag-row-height override; returns row 0's heights. */
const mountThemed = async (theme: "legacy" | undefined) => {
  let api!: GridApi<CarRow>;
  const { container, unmount } = render(() => (
    <div
      class="ag-theme-quartz"
      style={{
        height: "300px",
        width: "500px",
        "--ag-row-height": `${ROW_HEIGHT_OVERRIDE}px`,
      }}
    >
      <AgGridSolid
        theme={theme}
        columnDefs={[{ field: "make" }, { field: "price" }]}
        rowData={rowData}
        ref={(r) => (api = r.api)}
      />
    </div>
  ));
  await vi.waitFor(() => {
    expect(container.querySelectorAll(".ag-row").length).toBe(3);
  });
  const heights = {
    node: api.getDisplayedRowAtIndex(0)!.rowHeight,
    rendered: container.querySelector('.ag-row[row-index="0"]')!.getBoundingClientRect().height,
  };
  unmount();
  return heights;
};

describe("legacy CSS theming (theme='legacy' + ag-theme-quartz class)", () => {
  it("theme='legacy' sizes rows from the theme CSS's --ag-row-height; the Theming API default does not", async () => {
    const legacy = await mountThemed("legacy");
    // the core read the CSS variable, and the rendered row follows it
    expect(legacy.node).toBe(ROW_HEIGHT_OVERRIDE);
    expect(legacy.rendered).toBe(ROW_HEIGHT_OVERRIDE);

    // same markup and override without the prop: the Theming API's own row height wins, so
    // the legacy result above is the prop's doing, not the stylesheet's
    const themingApi = await mountThemed(undefined);
    expect(themingApi.node).not.toBe(ROW_HEIGHT_OVERRIDE);
    expect(themingApi.rendered).not.toBe(ROW_HEIGHT_OVERRIDE);
  });
});
