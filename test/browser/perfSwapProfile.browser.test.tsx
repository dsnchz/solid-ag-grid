// CPU PROFILE of the row swap (diagnostic, perf project): splits DISPOSE (old rows/cells torn
// down) from MOUNT (new rows/cells created) by function-name classification of CDP self time,
// Solid vs vanilla. Same synchronous scroll drive as perfCompare (scroll event dispatched under
// suppressAnimationFrame; target row asserted inside the window).
import { cdp } from "@vitest/browser/context";
import { render } from "@solidjs/testing-library";
import type { GridApi, GridOptions } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const ROWS = 20_000;
const COLS = 10;
const SWAPS = 20;
const ROUNDS = 5;

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
};

const DISPOSE =
  /dispose|unobserved|cleanup|clearDeps|destroy|remove|unsubscribe|deleteFromHeap|onCleanup|_removeFromParent|clearStatus/i;
const MOUNT =
  /create|computed|signal|effect|insert|template|clone|setComp|init|construct|Comp$|render|mount|append|setAttribute|link|read|recompute|runEffect|flush|Show|For|mapArray|postConstruct|wire|setup|add/i;

const bucketOf = (url: string, fn: string): string => {
  if (fn === "(garbage collector)") return "gc";
  if (fn === "(program)") return "(program)";
  if (fn === "(idle)") return "(idle)";
  if (fn === "(root)") return "(root)";
  let owner: string;
  if (/solid-js|@solidjs|solid\.js|solid-[A-Za-z0-9]+\.js|web\.js|signals/.test(url))
    owner = "solid runtime";
  else if (/\/src\//.test(url)) owner = "solid-ag-grid src";
  else if (/ag-grid-community|ag-stack/.test(url)) owner = "ag-grid core";
  else if (url === "") owner = "DOM/native";
  else owner = "other";
  const side = DISPOSE.test(fn) ? "dispose" : MOUNT.test(fn) ? "mount" : "unclassified";
  return `${owner} · ${side}`;
};

function aggregate(profile: Profile, buckets: Map<string, number>, fns: Map<string, number>) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]!;
    selfUs.set(id, (selfUs.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
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
  return total;
}

const settle = async () => {
  flush();
  await new Promise<void>((r) => queueMicrotask(r));
  flush();
};

async function mount(renderer: "solid" | "vanilla") {
  const { columnDefs, rowData } = buildData();
  const host = document.createElement("div");
  host.style.cssText = "height:500px;width:900px";
  document.body.appendChild(host);
  let api!: GridApi;
  const options: GridOptions = {
    columnDefs,
    rowData,
    getRowId: (p) => String(p.data.id),
    suppressAnimationFrame: true,
  };
  if (renderer === "vanilla") api = createGrid(host, options);
  else render(() => <AgGridSolid {...options} ref={(r) => (api = r.api)} />, { container: host });
  await new Promise<void>((r) => {
    const poll = () => (host.querySelector(".ag-cell") ? r() : setTimeout(poll, 5));
    poll();
  });
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const scrollTo = (index: number) => {
    api.ensureIndexVisible(index);
    host.querySelector(".ag-body-viewport")?.dispatchEvent(new Event("scroll"));
  };
  return { api, host, scrollTo };
}

const ms = (us: number) => (us / 1000).toFixed(2);

describe("row swap CPU profile: dispose vs mount (diagnostic)", () => {
  it("20k x 10, 20 swaps x 5 rounds per renderer: self time by owner·side and top functions", async () => {
    const session = cdp();
    const report: string[] = [];
    for (const renderer of ["solid", "vanilla"] as const) {
      const { api, host, scrollTo } = await mount(renderer);
      // warm the swap path before profiling
      for (let i = 1; i <= 5; i++) {
        scrollTo(i * 700);
        await settle();
      }
      const buckets = new Map<string, number>();
      const fns = new Map<string, number>();
      let total = 0;
      let wall = 0;
      const stride = Math.floor(ROWS / (SWAPS + 1));
      await session.send("Profiler.enable");
      await session.send("Profiler.setSamplingInterval", { interval: 50 });
      for (let round = 0; round < ROUNDS; round++) {
        await session.send("Profiler.start");
        const t0 = performance.now();
        for (let i = 1; i <= SWAPS; i++) {
          const target = ((i + round * 3) % SWAPS) * stride + stride;
          scrollTo(target);
          await settle();
          expect(host.querySelector(`.ag-row[row-index="${target}"] .ag-cell`)).not.toBeNull();
        }
        wall += performance.now() - t0;
        const { profile } = (await session.send("Profiler.stop")) as { profile: Profile };
        total += aggregate(profile, buckets, fns);
      }
      await session.send("Profiler.disable");
      const swaps = SWAPS * ROUNDS;
      report.push(
        `\n===== ${renderer.toUpperCase()}  per swap: wall ${(wall / swaps).toFixed(2)} ms | sampled ${ms(total / swaps)} ms`,
      );
      const side = { dispose: 0, mount: 0, unclassified: 0 };
      for (const [b, us] of [...buckets].sort((a, b) => b[1] - a[1])) {
        report.push(`  ${b.padEnd(32)} ${ms(us / swaps).padStart(7)} ms/swap`);
        const s = b.split(" · ")[1] as keyof typeof side | undefined;
        if (s && s in side) side[s] += us;
      }
      report.push(
        `  SIDE TOTALS per swap: dispose ${ms(side.dispose / swaps)} | mount ${ms(side.mount / swaps)} | unclassified ${ms(side.unclassified / swaps)}`,
      );
      report.push("  top functions (self, ms per swap):");
      for (const [k, us] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, 36)) {
        if (us / swaps < 15) break;
        report.push(`    ${ms(us / swaps).padStart(6)}  ${k}`);
      }
      api.destroy?.();
      host.remove();
    }
    console.warn("SWAPPROFILE" + report.join("\n"));
  }, 300_000);
});
