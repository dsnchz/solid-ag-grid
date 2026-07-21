// The "no more Jotai" regression test: a grid-created user component (here a custom
// noRows overlay — community-module stand-in for the status-bar/footer case) reads an
// EXTERNAL app signal and updates live, with zero grid API involvement. In React this
// requires an external store (the grid's portal children are render-isolated from app
// state); in Solid the component's JSX subscription IS the update path.
import { render } from "@solidjs/testing-library";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const [label, setLabel] = createSignal("connected: 0");

const ExternalSignalOverlay = () => <div data-testid="external-overlay">status: {label()}</div>;

describe("external signal reactivity in grid-created components", () => {
  it("updates a grid-created component from an app signal with no grid API calls", async () => {
    const { findByTestId } = render(() => (
      <div style={{ height: "300px" }}>
        <AgGridSolid
          columnDefs={[{ field: "a" }]}
          rowData={[]}
          noRowsOverlayComponent={ExternalSignalOverlay}
        />
      </div>
    ));

    const overlay = await findByTestId("external-overlay");
    expect(overlay.textContent).toBe("status: connected: 0");

    setLabel("connected: 42");
    flush();

    expect(overlay.textContent).toBe("status: connected: 42");
  });
});
