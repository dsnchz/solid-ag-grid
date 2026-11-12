// RenderStatusService (the port's IRenderStatusService bean) queues column-resize operations
// for one macrotask after data events so `api.autoSizeColumns(...)` called from an event
// handler measures cells Solid has already rendered (React parity, same DX). Pins:
// 1. The DX contract: autoSizeAllColumns() from onRowDataUpdated measures the updated cells.
// 2. The coalescing: a 500-row update fires the per-row data events 500 times but schedules
//    ONE drain timer, not one per row (measured: 501 setTimeout calls per tick before the fix,
//    ~0.2 ms of timer scheduling plus 500 macrotask turns per streaming tick).
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: number; text: string };
const ROWS = 1_000;
const INITIAL_WIDTH = 400;

const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};
const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

const mount = async (extra: GridOptions<Row>) => {
  const host = document.createElement("div");
  host.style.cssText = "height:400px;width:900px";
  document.body.appendChild(host);
  let api!: GridApi<Row>;
  const options: GridOptions<Row> = {
    columnDefs: [{ field: "text", width: INITIAL_WIDTH }],
    rowData: Array.from({ length: ROWS }, (_, id) => ({ id, text: `t${id}` })),
    getRowId: (p) => String(p.data.id),
    ...extra,
  };
  render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  await new Promise<void>((r) => {
    const poll = () => (host.querySelector(".ag-cell") ? r() : setTimeout(poll, 5));
    poll();
  });
  await settle();
  await macrotask();
  return { api, host };
};

describe("render status service: queued resize operations", () => {
  it("autoSizeAllColumns() from onRowDataUpdated measures the updated cells after the tick (DX contract)", async () => {
    // armed after mount: the boot's own rowDataUpdated would otherwise autosize at load
    let armed = false;
    const { api, host } = await mount({
      onRowDataUpdated: (e) => {
        if (armed) {
          e.api.autoSizeAllColumns();
        }
      },
    });
    const textWidth = () => api.getColumn("text")!.getActualWidth();
    // baseline: what an autosize gives the mounted `t<n>` cells (no data event → runs at once)
    api.autoSizeAllColumns();
    const oldContentWidth = textWidth();
    expect(oldContentWidth).not.toBe(INITIAL_WIDTH);

    armed = true;
    api.applyTransaction({
      update: [{ id: 0, text: "a distinctly longer value than any t<n> label in the column" }],
    });
    await settle();
    await macrotask();
    await macrotask();
    const eventDrivenWidth = textWidth();
    // the event-driven autosize measured the NEW content: it is wider than the old-content
    // fit and equals a fresh autosize taken now, long after the updated cell rendered (one
    // that measured before the updated cell rendered would land on the stale `t0` width)
    expect(eventDrivenWidth).toBeGreaterThan(oldContentWidth);
    api.autoSizeAllColumns();
    expect(eventDrivenWidth).toBe(textWidth());
    api.destroy();
    host.remove();
  });

  it("a 500-row update schedules one drain timer, not one per row", async () => {
    const { api, host } = await mount({});
    const original = window.setTimeout;
    let calls = 0;
    window.setTimeout = function (this: unknown, ...args: Parameters<typeof setTimeout>) {
      calls++;
      return original.apply(this, args);
    } as typeof setTimeout;
    try {
      api.applyTransaction({
        update: Array.from({ length: 500 }, (_, id) => ({ id, text: `u${id}` })),
      });
      await settle();
    } finally {
      window.setTimeout = original;
    }
    // the grid core itself schedules a handful of timers per transaction; the point is the
    // absence of the per-row 500
    expect(calls).toBeLessThan(20);
    api.destroy();
    host.remove();
  });
});
