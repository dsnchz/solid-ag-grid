// T6 SSR contract: the rowStore adapter must be inert server-side — the shell divs render,
// no adapter effects are created, no snapshots taken, no console noise, no grid boot.
import { renderToString } from "@solidjs/web";
import type { GetRowIdParams } from "ag-grid-community";
import { createStore } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

type Row = { readonly id: string; readonly name: string };

describe("SSR rowStore", () => {
  it("renders the shell only, stays silent, and never reads the rowStore or calls getRowId", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const [store] = createStore<Row[]>([{ id: "a", name: "alpha" }]);
    // the compiled `rowStore={readStore()}` is a getter: any server-side read of the prop counts
    let storeReads = 0;
    const readStore = () => {
      storeReads++;
      return store;
    };
    const getRowId = vi.fn((params: GetRowIdParams<Row>) => params.data.id);

    const html = renderToString(() => (
      <AgGridSolid
        class="my-grid"
        columnDefs={[{ field: "name" }]}
        rowStore={readStore()}
        getRowId={getRowId}
      />
    ));

    expect(html).toContain("my-grid");
    const divCount = (html.match(/<div/g) ?? []).length;
    expect(divCount).toBe(4);
    expect(html).not.toContain("ag-root-wrapper");
    // adapter inertness: no prop read (so no seed snapshot) and no row keying
    expect(storeReads).toBe(0);
    expect(getRowId).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
