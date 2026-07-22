// T4 ship check: perf smoke — 100k rows x 10 cols must initially render, scroll, and not
// crash. Timings are logged for the ship report but deliberately NOT asserted with tight
// bounds (CI perf is noisy; these are informational). The only hard assertions are
// correctness: rows render, scrolling reaches distant rows, the api stays alive.
import { render } from "@solidjs/testing-library";
import type { GridApi } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const NUM_ROWS = 100_000;
const NUM_COLS = 10;

type WideRow = { [key: string]: string | number; id: number };

const buildRows = (): WideRow[] => {
  const rows: WideRow[] = new Array(NUM_ROWS);
  for (let i = 0; i < NUM_ROWS; i++) {
    const row = { id: i } as WideRow;
    for (let c = 0; c < NUM_COLS; c++) {
      row[`col${c}`] = c === 0 ? i : `r${i}c${c}`;
    }
    rows[i] = row;
  }
  return rows;
};

const columnDefs = Array.from({ length: NUM_COLS }, (_, c) => ({ field: `col${c}` }));

describe("perf smoke: 100k rows x 10 cols", () => {
  it("renders initially, scrolls to distant rows, and survives", async () => {
    const tBuild = performance.now();
    const rowData = buildRows();
    const builtMs = performance.now() - tBuild;

    let api: GridApi | undefined;
    const tRender = performance.now();
    const { container, unmount } = render(() => (
      <div style={{ height: "500px", width: "900px" }}>
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={rowData}
          getRowId={(params) => String(params.data.id)}
          ref={(r: AgGridSolidRef) => (api = r.api)}
        />
      </div>
    ));

    // initial render: api ready + first viewport rows in the DOM
    await vi.waitFor(
      () => {
        expect(api).toBeDefined();
        expect(container.querySelectorAll(".ag-row").length).toBeGreaterThan(5);
      },
      { timeout: 30_000 },
    );
    const initialRenderMs = performance.now() - tRender;
    expect(container.textContent).toContain("r0c1");
    expect(api!.getDisplayedRowCount()).toBe(NUM_ROWS);

    // scroll to the middle of the data set
    const tScrollMid = performance.now();
    api!.ensureIndexVisible(50_000, "top");
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain("r50000c1");
      },
      { timeout: 15_000 },
    );
    const scrollMidMs = performance.now() - tScrollMid;

    // scroll to the end
    const tScrollEnd = performance.now();
    api!.ensureIndexVisible(NUM_ROWS - 1, "bottom");
    await vi.waitFor(
      () => {
        expect(container.textContent).toContain(`r${NUM_ROWS - 1}c1`);
      },
      { timeout: 15_000 },
    );
    const scrollEndMs = performance.now() - tScrollEnd;

    // back to the top — grid is still alive and consistent
    api!.ensureIndexVisible(0, "top");
    await vi.waitFor(() => {
      expect(container.textContent).toContain("r0c1");
    });
    expect(api!.isDestroyed()).toBe(false);

    // informational timings for the ship report (visible in vitest stdout)
    console.log(
      `[perf-smoke] rows=${NUM_ROWS} cols=${NUM_COLS} ` +
        `buildData=${builtMs.toFixed(0)}ms initialRender=${initialRenderMs.toFixed(0)}ms ` +
        `scrollTo50k=${scrollMidMs.toFixed(0)}ms scrollToEnd=${scrollEndMs.toFixed(0)}ms`,
    );

    unmount();
  }, 120_000);
});
