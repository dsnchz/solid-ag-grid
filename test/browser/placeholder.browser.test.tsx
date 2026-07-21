import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

describe("AgGridSolid placeholder (browser)", () => {
  it("renders in a real browser with layout", async () => {
    const { findByTestId } = render(() => <AgGridSolid class="my-grid" />);
    const el = await findByTestId("ag-grid-solid-placeholder");
    expect(el.getBoundingClientRect().height).toBeGreaterThan(0);
  });
});
