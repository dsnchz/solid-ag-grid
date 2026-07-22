import type { JSX } from "@solidjs/web";
import { createSignal, For, Show } from "solid-js";

import { ApiConsole } from "./scenarios/ApiConsole";
import { AsyncCells } from "./scenarios/AsyncCells";
import { AsyncRows } from "./scenarios/AsyncRows";
import { Basics } from "./scenarios/Basics";
import { CustomComponents } from "./scenarios/CustomComponents";
import { Editors } from "./scenarios/Editors";
import { ExternalSignals } from "./scenarios/ExternalSignals";
import { MasterDetail } from "./scenarios/MasterDetail";
import { Performance } from "./scenarios/Performance";
import { Theming } from "./scenarios/Theming";

type Scenario = {
  readonly id: string;
  readonly nav: string;
  readonly title: string;
  readonly blurb: string;
  readonly Comp: () => JSX.Element;
};

const SCENARIOS: Scenario[] = [
  {
    id: "basics",
    nav: "Basics",
    title: "Basics — sorting, filtering, resizing, selection",
    blurb:
      "The bread-and-butter grid: sortable/filterable/resizable columns, multi-row checkbox selection, pagination, and a reactive quick-filter input driving the quickFilterText prop from a signal.",
    Comp: Basics,
  },
  {
    id: "async-rows",
    nav: "Async rowData (SWR)",
    title: "Async row data — stale-while-revalidate for free",
    blurb:
      'rowData is an async createMemo. First load shows the grid\'s loading overlay; switching datasets keeps the previous rows visible until the new fetch resolves — no overlay flash, no blanking. The "revalidating" badge is driven by isPending() outside the grid.',
    Comp: AsyncRows,
  },
  {
    id: "async-cells",
    nav: "Async cell renderers",
    title: "Async cell renderers — per-cell loading boundaries",
    blurb:
      "Cell renderers read async computations directly. Each cell has its own <Loading> boundary showing colDef.loadingCellRenderer until its own data settles — cells reveal independently, on a staggered schedule.",
    Comp: AsyncCells,
  },
  {
    id: "signals",
    nav: "External signals",
    title: "External signals — live ticker with zero grid API calls",
    blurb:
      "Cell renderers and the no-rows overlay read module-level app signals. A feed interval updates the price signal and every subscribed cell updates in place — the grid is never told anything. Clear the rows to see the overlay track the same feed status live.",
    Comp: ExternalSignals,
  },
  {
    id: "components",
    nav: "Custom components",
    title: "Custom components — filter, floating filter, header, overlays",
    blurb:
      "The reactive custom components system: a checkbox filter registered with useGridFilter, a floating filter mirroring its model, a custom sortable header, and custom loading / no-rows overlays. Model changes are pushed into live components — no remounts.",
    Comp: CustomComponents,
  },
  {
    id: "editors",
    nav: "Editors",
    title: "Editors — inline custom, popup, and validation",
    blurb:
      'Double-click to edit. "name" is a custom inline Solid editor with live validation (empty values are rejected via isCancelAfterEnd). "dept" is a custom popup picker. "salary" uses the built-in number editor. Names of Finance employees refuse to start editing via isCancelBeforeStart.',
    Comp: Editors,
  },
  {
    id: "master-detail",
    nav: "Master / detail",
    title: "Full-width rows — master/detail with a nested grid",
    blurb:
      "Community-edition master/detail: expanding a row inserts a detail row rendered by fullWidthCellRenderer, which mounts a second, fully independent AgGridSolid showing that car's orders. Row identity is kept stable with getRowId.",
    Comp: MasterDetail,
  },
  {
    id: "theming",
    nav: "Theming",
    title: "Theming — Theming API themes and legacy CSS mode",
    blurb:
      'The theme prop is reactive: switch between themeQuartz, a withParams() variant, and themeBalham at runtime on the same grid. Legacy mode remounts the grid with theme="legacy" and scoped legacy stylesheets, exactly as a migrating app would.',
    Comp: Theming,
  },
  {
    id: "performance",
    nav: "Performance (100k)",
    title: "Performance — 100,000 rows + live transaction stream",
    blurb:
      "100k rows loaded through the normal rowData prop, then updated via applyTransactionAsync from a start/stoppable stream (batches of updates every frame-ish). The FPS meter and update counter run outside the grid.",
    Comp: Performance,
  },
  {
    id: "api",
    nav: "Grid API console",
    title: "Grid API console — driving the grid via ref",
    blurb:
      "The GridApi arrives through the ref callback once the grid UI is ready. Every button below calls a real api method; results are appended to the log.",
    Comp: ApiConsole,
  },
];

const initialPage = () => {
  const hash = location.hash.replace(/^#\/?/, "");
  return SCENARIOS.some((s) => s.id === hash) ? hash : "basics";
};

export const App = () => {
  const [current, setCurrent] = createSignal(initialPage());
  const go = (id: string) => {
    setCurrent(id);
    location.hash = `/${id}`;
  };
  return (
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-title">solid-ag-grid</span>
          <span class="brand-sub">dogfood playground · v36.0.0-next.1</span>
        </div>
        <nav>
          <For each={SCENARIOS}>
            {(s) => (
              <button
                class={current() === s.id ? "nav-item active" : "nav-item"}
                onClick={() => go(s.id)}
              >
                {s.nav}
              </button>
            )}
          </For>
        </nav>
        <div class="sidebar-foot">
          published package · npm <code>@next</code>
        </div>
      </aside>
      <main class="content">
        <For each={SCENARIOS}>
          {(s) => (
            <Show when={current() === s.id}>
              <section class="page">
                <h1>{s.title}</h1>
                <p class="blurb">{s.blurb}</p>
                <s.Comp />
              </section>
            </Show>
          )}
        </For>
      </main>
    </div>
  );
};
