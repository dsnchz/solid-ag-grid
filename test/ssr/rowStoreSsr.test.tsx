// T6 SSR contract: the rowStore adapter must be inert server-side — the shell divs render,
// no adapter effects are created, no snapshots taken, no console noise, no grid boot.
import { renderToString } from "@solidjs/web";
// eslint-disable-next-line solid/imports -- createStore is exported from "solid-js" in 2.0 (plugin predates 2.0)
import { createStore } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

type Row = { readonly id: string; readonly name: string };

describe("SSR rowStore", () => {
  it("renders the shell only and stays silent with a rowStore-driven grid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store] = createStore<Row[]>([{ id: "a", name: "alpha" }]);

    const html = renderToString(() => (
      <AgGridSolid
        class="my-grid"
        columnDefs={[{ field: "name" }]}
        rowStore={store}
        getRowId={(params) => params.data.id}
      />
    ));

    expect(html).toContain("my-grid");
    const divCount = (html.match(/<div/g) ?? []).length;
    expect(divCount).toBe(4);
    expect(html).not.toContain("ag-root-wrapper");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
