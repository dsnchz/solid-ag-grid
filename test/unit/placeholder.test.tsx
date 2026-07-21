import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

describe("AgGridSolid placeholder (jsdom)", () => {
  it("renders and settles ready state", async () => {
    const { findByTestId } = render(() => <AgGridSolid class="my-grid" />);
    const el = await findByTestId("ag-grid-solid-placeholder");
    expect(el).toBeInstanceOf(HTMLDivElement);
    expect(el.classList.contains("my-grid")).toBe(true);
  });
});
