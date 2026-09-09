// CPU PROFILE of the viewport mount (Solid vs vanilla) via CDP — diagnostic, not a benchmark.
// Ten 1k-row mounts per renderer, self time aggregated per bucket and per function. Findings
// 2026-09-09 (rc.7, prod posture): solid-ag-grid src + Solid runtime ≈ 1.4 ms/mount of the
// ~3-5 ms viewport mount; ag-grid core self time identical on both sides; the remainder sits
// under V8's "(program)" (first-mount codegen/ICs, template cloning) — no single hotspot.
// Runs in the `perf` project; read the report with `vitest run --project perf perfProfile`.
import { render } from "@solidjs/testing-library";
import { cdp } from "@vitest/browser/context";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROWS = 1_000;
const COLS = 10;
const buildData = () => {
  const fields = Array.from({ length: COLS }, (_, c) => `f${c}`);
  const data = Array.from({ length: ROWS }, (_, r) => {
    const row: Record<string, number> = { id: r };
    for (let c = 0; c < COLS; c++) row[fields[c]!] = r * COLS + c;
    return row;
  });
  return { columnDefs: fields.map((field) => ({ field, width: 120 })), rowData: data };
};

type Profile = {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
};

const bucketOf = (url: string, fn: string): string => {
  if (fn === "(garbage collector)") return "gc";
  if (fn === "(program)") return "(program)";
  if (fn === "(idle)") return "(idle)";
  if (fn === "(root)") return "(root)";
  if (/solid-js|@solidjs|solid\.js|web\.js|signals/.test(url)) return "solid runtime";
  if (/\/src\//.test(url)) return "solid-ag-grid src";
  if (/ag-grid-community|ag-stack/.test(url)) return "ag-grid core";
  if (/@vitest|vitest|@solidjs\/testing-library/.test(url)) return "test harness";
  if (url === "") return "(native/anon)";
  return "other";
};

async function mount(renderer: "solid" | "vanilla", host: HTMLElement) {
  const { columnDefs, rowData } = buildData();
  let api!: GridApi;
  const options: GridOptions = { columnDefs, rowData, getRowId: (p) => String(p.data.id) };
  const t0 = performance.now();
  if (renderer === "vanilla") api = createGrid(host, options);
  else render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  const tSync = performance.now() - t0;
  await new Promise<void>((r) => {
    const poll = () => (host.querySelector(".ag-cell") ? r() : setTimeout(poll, 0));
    poll();
  });
  const tCell = performance.now() - t0;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const tPaint = performance.now() - t0;
  return { api, tSync, tCell, tPaint };
}

async function profiled(renderer: "solid" | "vanilla") {
  const session = cdp();
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 50 });
  await session.send("Profiler.start");
  const timings = await mount(renderer, host);
  const { profile } = (await session.send("Profiler.stop")) as { profile: Profile };
  await session.send("Profiler.disable");
  const counts = {
    cells: host.querySelectorAll(".ag-cell").length,
    rows: host.querySelectorAll(".ag-row").length,
  };
  timings.api.destroy?.();
  host.remove();
  return { timings, profile, counts };
}

function aggregate(profile: Profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]!;
    selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const buckets = new Map<string, number>();
  const fns = new Map<string, number>();
  let total = 0;
  for (const [id, us] of selfUs) {
    const n = byId.get(id)!;
    const b = bucketOf(n.callFrame.url, n.callFrame.functionName);
    buckets.set(b, (buckets.get(b) ?? 0) + us);
    total += us;
    const file = n.callFrame.url.split("/").slice(-1)[0]?.split("?")[0] ?? "";
    const key = `${n.callFrame.functionName || "(anonymous)"}  ${file}:${n.callFrame.lineNumber + 1}`;
    fns.set(key, (fns.get(key) ?? 0) + us);
  }
  return { total, buckets, fns };
}

const ms = (us: number) => (us / 1000).toFixed(1);

describe("initial render CPU profile (diagnostic)", () => {
  it("1k x 10, viewport mount phase: Solid vs vanilla self time by bucket and function", async () => {
    // warmup both, then profile each twice; report the second
    for (const r of ["solid", "vanilla"] as const) {
      const host = document.createElement("div");
      host.style.cssText = "height:500px;width:900px";
      document.body.appendChild(host);
      (await mount(r, host)).api.destroy?.();
      host.remove();
    }
    const report: string[] = [];
    const N = 10;
    for (const renderer of ["solid", "vanilla"] as const) {
      const buckets = new Map<string, number>();
      const fns = new Map<string, number>();
      let total = 0;
      let wall = 0;
      let cells = 0;
      let rows = 0;
      for (let i = 0; i < N; i++) {
        const { timings, profile, counts } = await profiled(renderer);
        const a = aggregate(profile);
        total += a.total;
        wall += timings.tCell;
        cells = counts.cells;
        rows = counts.rows;
        for (const [b, us] of a.buckets) buckets.set(b, (buckets.get(b) ?? 0) + us);
        for (const [k, us] of a.fns) fns.set(k, (fns.get(k) ?? 0) + us);
      }
      report.push(
        `\n===== ${renderer.toUpperCase()} x${N} (1k rows): mean first-cell ${(wall / N).toFixed(1)}ms | viewport ${rows} rows / ${cells} cells | sampled total ${ms(total)}ms (per mount ${ms(total / N)}ms)`,
      );
      for (const [b, us] of [...buckets].sort((a, b) => b[1] - a[1])) {
        report.push(`  ${b.padEnd(18)} ${ms(us / N).padStart(7)} ms/mount`);
      }
      report.push("  top functions (self, ms per mount):");
      for (const [k, us] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
        if (us / N < 40) break;
        report.push(`    ${ms(us / N).padStart(6)}  ${k}`);
      }
    }
    console.warn("PROFILE" + report.join("\n"));
    expect(true).toBe(true);
  }, 300_000);
});
