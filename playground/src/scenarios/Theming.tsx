import { AgGridSolid } from "@dschz/solid-ag-grid";
import type { ColDef, Theme } from "ag-grid-community";
import { themeBalham, themeQuartz } from "ag-grid-community";
// Legacy stylesheets imported as strings and mounted ONLY while legacy mode is active,
// so they never leak into the Theming API grids.
import legacyStructuralCss from "ag-grid-community/styles/ag-grid.css?inline";
import legacyQuartzCss from "ag-grid-community/styles/ag-theme-quartz.css?inline";
import { createSignal, For, Match, Switch } from "solid-js";

import type { Employee } from "../data";
import { makeEmployees, money } from "../data";

const tintedQuartz = themeQuartz.withParams({
  accentColor: "#e11d48",
  spacing: 6,
  headerBackgroundColor: "#fdf2f8",
  headerTextColor: "#9f1239",
});

const THEMES: { id: string; label: string; theme: Theme }[] = [
  { id: "quartz", label: "themeQuartz", theme: themeQuartz },
  { id: "tinted", label: "themeQuartz.withParams(…)", theme: tintedQuartz },
  { id: "balham", label: "themeBalham", theme: themeBalham },
];

const columnDefs: ColDef<Employee>[] = [
  { field: "name", minWidth: 170 },
  { field: "dept", headerName: "Department" },
  { field: "country" },
  { field: "salary", valueFormatter: (p) => money(p.value) },
];

const rowData = makeEmployees(60, 3);

export const Theming = () => {
  const [mode, setMode] = createSignal("quartz");
  const currentTheme = () => THEMES.find((t) => t.id === mode())?.theme ?? themeQuartz;

  return (
    <>
      <div class="toolbar">
        <For each={THEMES}>
          {(t) => (
            <button class={mode() === t.id ? "btn active" : "btn"} onClick={() => setMode(t.id)}>
              {t.label}
            </button>
          )}
        </For>
        <button
          class={mode() === "legacy" ? "btn active" : "btn"}
          onClick={() => setMode("legacy")}
        >
          theme="legacy" + CSS files
        </button>
      </div>
      <Switch>
        <Match when={mode() !== "legacy"}>
          {/* One grid, reactive theme prop: Theming API themes swap at runtime. */}
          <div class="grid-box short">
            <AgGridSolid
              columnDefs={columnDefs}
              rowData={rowData}
              theme={currentTheme()}
              defaultColDef={{ flex: 1, sortable: true }}
            />
          </div>
        </Match>
        <Match when={mode() === "legacy"}>
          {/* Legacy mode mounts its own grid instance with the classic CSS-file themes,
              scoped to this branch so the stylesheets unmount when you switch back. */}
          <style>{legacyStructuralCss}</style>
          <style>{legacyQuartzCss}</style>
          <div class="ag-theme-quartz grid-box short">
            <AgGridSolid
              columnDefs={columnDefs}
              rowData={rowData}
              theme="legacy"
              defaultColDef={{ flex: 1, sortable: true }}
            />
          </div>
        </Match>
      </Switch>
      <p class="hint">
        The three Theming API buttons update the same grid instance through the reactive
        <code> theme</code> prop — no remount. The legacy button mounts a separate grid with
        <code> theme="legacy"</code> and the classic <code>ag-theme-quartz</code> CSS files (the
        pre-v33 styling path), injected only while this mode is active.
      </p>
    </>
  );
};
