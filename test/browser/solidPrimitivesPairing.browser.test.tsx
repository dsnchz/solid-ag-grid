// Ecosystem-pairing pin: @solid-primitives/resize-observer (Solid 2.0 line) working with
// the grid in both integration directions — (1) their observer on our container driving a
// grid API call (external event → command path), and (2) their size signal feeding a
// reactive grid prop (signal → options doorway). Guards that the wrapper plays well with
// the primitives ecosystem, not just bare solid-js.
import { createElementSize, createResizeObserver } from "@solid-primitives/resize-observer";
import { render } from "@solidjs/testing-library";
import type { GridApi } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createMemo, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

describe("pairing with @solid-primitives/resize-observer", () => {
  it("observer on the grid container drives sizeColumnsToFit; size signal drives a prop", async () => {
    let api: GridApi | undefined;
    // signal ref: a plain `let` closed over by the accessor stays undefined forever (the
    // body runs before refs; nothing re-evaluates a non-reactive accessor) — the observer
    // would never attach. The signal makes attachment reactive to the ref arriving.
    const [host, setHost] = createSignal<HTMLDivElement>();
    const [width, setWidth] = createSignal(600);
    const fitSpy = vi.fn();

    const App = () => {
      // component BODY, accessor target — the correct 2.0 placement. Calling this inside
      // onSettled halts the reactive system: the primitive uses onCleanup internally, which
      // is CLEANUP_IN_FORBIDDEN_SCOPE there (docs/reactivity.md footgun 8, ecosystem
      // corollary — pinned by this test's history).
      createResizeObserver(
        () => host(),
        () => {
          if (api) {
            api.sizeColumnsToFit();
            fitSpy();
          }
        },
      );

      const size = createElementSize(() => host());
      // size signal → reactive grid prop (the options doorway)
      const headerHeight = createMemo(() => ((size.width ?? 600) > 500 ? 40 : 28));

      return (
        <div ref={setHost} style={{ width: `${width()}px`, height: "300px" }}>
          <AgGridSolid
            // 2 x 100px: a sum that matches neither container width, so only a real fit lands
            // the total on the grid body width
            columnDefs={[
              { field: "a", width: 100 },
              { field: "b", width: 100 },
            ]}
            rowData={[{ a: 1, b: 2 }]}
            headerHeight={headerHeight()}
            ref={(r) => (api = r.api)}
          />
        </div>
      );
    };

    const { container } = render(() => <App />);
    await vi.waitFor(() => expect(api).toBeDefined());
    await vi.waitFor(() => expect(container.querySelector(".ag-cell")).toBeTruthy());

    const headerHeightPx = () =>
      parseInt(container.querySelector<HTMLElement>(".ag-header")!.style.height, 10);
    // rendered height includes grid borders — assert semantically, not by string
    expect(headerHeightPx()).toBeGreaterThanOrEqual(40);

    // shrink the container: their observer must fire and drive the fit; the size signal
    // must flow into the reactive headerHeight prop
    setWidth(400);
    flush();

    await vi.waitFor(() => expect(fitSpy).toHaveBeenCalled());
    await vi.waitFor(() => {
      expect(headerHeightPx()).toBeLessThan(40);
    });

    // columns re-fit into the shrunk container: the total fills the grid body (the 400px
    // container less the grid border), not the 200px they started at nor the 600px container
    // they mounted in
    const columnsTotal = () => api!.getColumnState().reduce((sum, col) => sum + col.width!, 0);
    const bodyWidth = () => container.querySelector<HTMLElement>(".ag-root")!.clientWidth;
    await vi.waitFor(() => {
      expect(bodyWidth()).toBeGreaterThan(390);
      expect(bodyWidth()).toBeLessThanOrEqual(400);
      expect(columnsTotal()).toBe(bodyWidth());
    });
    // the header cells render the fitted widths
    const headerTotal = [...container.querySelectorAll<HTMLElement>(".ag-header-cell")].reduce(
      (sum, cell) => sum + cell.offsetWidth,
      0,
    );
    expect(headerTotal).toBe(columnsTotal());
  });
});
