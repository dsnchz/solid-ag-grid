import { render } from "@solidjs/testing-library";
import {
  AllCommunityModule,
  ModuleRegistry,
  getGridApi,
} from "ag-grid-community";
import { describe, expect, it } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("AgGridSolid entry (browser)", () => {
  it("renders the 3 styled-root layers and boots the grid core in real Chromium", async () => {
    const { container } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "300px" }}
        columnDefs={[{ field: "make" }, { field: "price" }]}
        rowData={[{ make: "Toyota", price: 35000 }]}
      />
    ));
    await settle();

    const outermost = container.firstElementChild as HTMLDivElement;
    const layer1 = outermost.firstElementChild as HTMLDivElement;
    const layer2 = layer1.firstElementChild as HTMLDivElement;
    const layer3 = layer2.firstElementChild as HTMLDivElement;
    for (const layer of [layer1, layer2, layer3]) {
      expect(layer).toBeInstanceOf(HTMLDivElement);
    }
    expect(layer3.querySelector(".ag-root-wrapper")).not.toBeNull();

    const api = getGridApi(outermost);
    expect(api).toBeDefined();
    expect(api!.isDestroyed()).toBe(false);
    expect(outermost.getBoundingClientRect().height).toBeGreaterThan(0);
  });
});
