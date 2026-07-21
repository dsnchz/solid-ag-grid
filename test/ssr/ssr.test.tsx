// Pins the SSR contract (ROADMAP testing pillar #6): server rendering produces the shell
// divs only, the grid core never boots server-side, and the AG Grid dependency chain is
// import-safe without a DOM. Runs in a plain node environment — no jsdom.
import { renderToString } from "@solidjs/web";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

describe("SSR", () => {
  it("runs in a real server environment (no DOM globals)", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("ag-grid-community and ag-stack are import-safe without a DOM", async () => {
    await expect(import("ag-grid-community")).resolves.toBeTruthy();
    await expect(import("ag-stack")).resolves.toBeTruthy();
  });

  it("renders the shell markup and does not boot the grid core", () => {
    const html = renderToString(() => (
      <AgGridSolid
        class="my-grid"
        columnDefs={[{ field: "make" }]}
        rowData={[{ make: "Toyota" }]}
      />
    ));

    // outer div (user class) + 3 unclassed styled-root layers
    expect(html).toContain("my-grid");
    const divCount = (html.match(/<div/g) ?? []).length;
    expect(divCount).toBe(4);
    // the grid core must not have booted: no grid DOM, no theming classes
    expect(html).not.toContain("ag-root-wrapper");
    expect(html).not.toContain("ag-styled-root");
  });
});
