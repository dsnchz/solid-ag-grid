// Ecosystem-pairing pin: @solid-primitives/resize-observer (Solid 2.0 line) working with
// the grid in both integration directions — (1) their observer on our container driving a
// grid API call (external event → command path), and (2) their size signal feeding a
// reactive grid prop (signal → options doorway). Guards that the wrapper plays well with
// the primitives ecosystem, not just bare solid-js.
import { createElementSize, createResizeObserver } from "@solid-primitives/resize-observer";
import { render } from "@solidjs/testing-library";
import type { GridApi } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createMemo, createSignal, flush, onSettled } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

describe("pairing with @solid-primitives/resize-observer", () => {
  it("observer on the grid container drives sizeColumnsToFit; size signal drives a prop", async () => {
    let api: GridApi | undefined;
    let host!: HTMLDivElement;
    const [width, setWidth] = createSignal(600);
    const fitSpy = vi.fn();

    const App = () => {
      // component BODY, accessor target — the correct 2.0 placement. Calling this inside
      // onSettled halts the reactive system: the primitive uses onCleanup internally, which
      // is CLEANUP_IN_FORBIDDEN_SCOPE there (docs/reactivity.md footgun 8, ecosystem
      // corollary — pinned by this test's history).
      createResizeObserver(
        () => host,
        () => {
          if (api) {
            api.sizeColumnsToFit();
            fitSpy();
          }
        },
      );

      const size = createElementSize(() => host);
      // size signal → reactive grid prop (the options doorway)
      const headerHeight = createMemo(() => ((size.width ?? 600) > 500 ? 40 : 28));

      return (
        <div ref={host} style={{ width: `${width()}px`, height: "300px" }}>
          <AgGridSolid
            columnDefs={[{ field: "a" }, { field: "b" }]}
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

    // columns re-fit into the shrunk container (sum of column widths ≈ new width)
    await vi.waitFor(() => {
      const widths = [...container.querySelectorAll<HTMLElement>(".ag-header-cell")].map(
        (c) => c.offsetWidth,
      );
      expect(widths.reduce((a, w) => a + w, 0)).toBeLessThanOrEqual(400);
    });
  });
});
