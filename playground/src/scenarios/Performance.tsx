import type { AgGridSolidRef } from "@dschz/solid-ag-grid";
import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef } from "ag-grid-community";
import { createSignal, onSettled } from "solid-js";

import type { PerfRow } from "../data";
import { makePerfRows, rng } from "../data";

const ROW_COUNT = 100_000;
const BATCH_SIZE = 500;
const TICK_MS = 50;

const columnDefs: ColDef<PerfRow>[] = [
  { field: "id", maxWidth: 110 },
  { field: "trader" },
  { field: "symbol", maxWidth: 110 },
  { field: "qty", maxWidth: 110 },
  { field: "price", valueFormatter: (p) => (p.value as number).toFixed(2) },
  {
    field: "pnl",
    headerName: "P&L",
    valueFormatter: (p) => (p.value as number).toFixed(2),
    cellStyle: (p) => ({ color: (p.value as number) >= 0 ? "#15803d" : "#b91c1c" }),
  },
];

export const Performance = () => {
  let grid: AgGridSolidRef<PerfRow> | undefined;

  const initialRows = makePerfRows(ROW_COUNT);
  // Latest row state by id, so successive transactions build on each other.
  const latest = new Map(initialRows.map((r) => [r.id, r]));
  const rand = rng(1234);

  const [running, setRunning] = createSignal(false);
  const [fps, setFps] = createSignal(0);
  const [updates, setUpdates] = createSignal(0);

  onSettled(() => {
    // FPS-ish meter: counts real animation frames per second, outside the grid.
    let frames = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      frames++;
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    });

    const interval = setInterval(() => {
      if (!running() || !grid) return;
      const batch: PerfRow[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const id = Math.floor(rand() * ROW_COUNT);
        const prev = latest.get(id);
        if (!prev) continue;
        const move = Math.round((rand() - 0.5) * 400) / 100;
        const next: PerfRow = {
          ...prev,
          price: Math.max(0.01, Math.round((prev.price + move) * 100) / 100),
          pnl: Math.round((prev.pnl + move * prev.qty) * 100) / 100,
        };
        latest.set(id, next);
        batch.push(next);
      }
      grid.api.applyTransactionAsync({ update: batch });
      setUpdates((u) => u + batch.length);
    }, TICK_MS);

    // Solid 2.0: cleanups from onSettled are RETURNED, not registered via onCleanup.
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(interval);
    };
  });

  return (
    <>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-label">rows</div>
          <div class="stat-value">{ROW_COUNT.toLocaleString()}</div>
        </div>
        <div class="stat">
          <div class="stat-label">fps</div>
          <div class="stat-value">{fps()}</div>
        </div>
        <div class="stat">
          <div class="stat-label">updates dispatched</div>
          <div class="stat-value">{updates().toLocaleString()}</div>
        </div>
        <div class="stat">
          <div class="stat-label">stream</div>
          <div class="stat-value">{running() ? "live" : "stopped"}</div>
        </div>
      </div>
      <div class="toolbar">
        <button
          class={running() ? "btn danger" : "btn primary"}
          onClick={() => setRunning((r) => !r)}
        >
          {running() ? "stop stream" : `start stream (${BATCH_SIZE} updates / ${TICK_MS}ms)`}
        </button>
      </div>
      <div class="grid-box">
        <AgGridSolid
          columnDefs={columnDefs}
          rowData={initialRows}
          getRowId={(params) => String(params.data.id)}
          asyncTransactionWaitMillis={60}
          ref={(r) => (grid = r)}
          defaultColDef={{ flex: 1, sortable: true }}
        />
      </div>
      <p class="hint">
        100k rows arrive through the plain <code>rowData</code> prop; the stream then feeds
        <code> api.applyTransactionAsync</code> with batches of updated row copies (identity-diffed
        by <code>getRowId</code>). Scroll and sort while it runs — the FPS meter is an ordinary
        Solid signal updated by requestAnimationFrame.
      </p>
    </>
  );
};
