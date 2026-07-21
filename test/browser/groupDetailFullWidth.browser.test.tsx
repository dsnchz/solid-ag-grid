// T3.10 browser coverage (Chromium): full-width rows + embedded full-width lanes vs vanilla,
// prop-push refresh identity, and the Open question 6 nested-grid re-entrancy verdict.
// Group/detail renderer BEHAVIOR is enterprise-gated (groupCellRendererCtrl /
// detailCellRendererCtrl dynamic beans) and covered structurally in
// test/unit/groupDetailFullWidth.test.tsx instead.
import { render } from "@solidjs/testing-library";
import type { GridOptions, ICellRendererParams } from "ag-grid-community";
import { AllCommunityModule, createGrid, ModuleRegistry } from "ag-grid-community";
import { describe, expect, it, vi } from "vitest";

import type { AgGridSolidRef } from "../../src/index";
import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type InfoRow = {
  id: string;
  info: string;
  wide: boolean;
};

const infoRows: InfoRow[] = [
  { id: "1", info: "normal-1", wide: false },
  { id: "2", info: "wide-2", wide: true },
  { id: "3", info: "normal-3", wide: false },
  { id: "4", info: "wide-4", wide: true },
];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const waitFor = async (cond: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const mountVanilla = <TData,>(options: GridOptions<TData>) => {
  const container = document.createElement("div");
  container.style.height = "400px";
  container.style.width = "600px";
  document.body.appendChild(container);
  const api = createGrid(container, options);
  return {
    container,
    api,
    destroy: () => {
      api.destroy();
      container.remove();
    },
  };
};

/** Vanilla (JS) full-width renderer used as the parity oracle's renderer. */
class JsFullWidthRenderer {
  private eGui!: HTMLElement;
  init(params: ICellRendererParams<InfoRow>) {
    this.eGui = document.createElement("div");
    this.eGui.classList.add("my-full-width");
    this.eGui.textContent = `FW: ${params.data?.info}`;
  }
  getGui() {
    return this.eGui;
  }
  refresh() {
    return false;
  }
}

const fullWidthOptions: GridOptions<InfoRow> = {
  columnDefs: [{ field: "id" }, { field: "info" }],
  rowData: infoRows,
  getRowId: (params) => params.data.id,
  isFullWidthRow: (params) => !!params.rowNode.data?.wide,
};

describe("Full-width rows (browser)", () => {
  it("parity: Solid full-width rows match vanilla (row classes, spanning, content, no cells)", async () => {
    const vanilla = mountVanilla<InfoRow>({
      ...fullWidthOptions,
      fullWidthCellRenderer: JsFullWidthRenderer,
    });
    const SolidFullWidth = (props: ICellRendererParams<InfoRow>) => (
      <div class="my-full-width">FW: {props.data?.info}</div>
    );
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "400px", width: "600px" }}
        {...fullWidthOptions}
        fullWidthCellRenderer={SolidFullWidth}
      />
    ));

    await waitFor(() => container.querySelectorAll(".my-full-width").length >= 2);
    await waitFor(() => vanilla.container.querySelectorAll(".my-full-width").length >= 2);
    await settle();

    const collect = (root: Element) =>
      new Map(
        [...root.querySelectorAll<HTMLElement>(".ag-row")].map((row) => [
          row.getAttribute("row-index")!,
          row,
        ]),
      );
    const vRows = collect(vanilla.container);
    const sRows = collect(container);
    expect([...sRows.keys()].sort()).toEqual([...vRows.keys()].sort());

    for (const [rowIndex, vRow] of vRows) {
      const sRow = sRows.get(rowIndex)!;
      // row class parity (ag-full-width-row et al come from the ctrl via toggleCss)
      expect(Array.from(sRow.classList).sort(), `row ${rowIndex} classes`).toEqual(
        Array.from(vRow.classList).sort(),
      );
      const isFw = vRow.classList.contains("ag-full-width-row");
      if (isFw) {
        // full-width content renders (inside our anchor div), spanning instead of cells
        expect(sRow.querySelector(".my-full-width")!.textContent).toBe(
          vRow.querySelector(".my-full-width")!.textContent,
        );
        expect(sRow.querySelector(".ag-full-width-anchor")).not.toBeNull();
        expect(sRow.querySelector(".ag-cell")).toBeNull();
        expect(vRow.querySelector(".ag-cell")).toBeNull();
      } else {
        expect(sRow.querySelectorAll(".ag-cell").length).toBe(
          vRow.querySelectorAll(".ag-cell").length,
        );
      }
      expect(sRow.style.top).toBe(vRow.style.top);
    }

    vanilla.destroy();
    unmount();
  });

  it("prop-push refresh: data update refreshes the Solid full-width renderer in place (same element, no remount)", async () => {
    let gridRef!: AgGridSolidRef<InfoRow>;
    let mountCount = 0;
    const SolidFullWidth = (props: ICellRendererParams<InfoRow>) => {
      mountCount++;
      return <div class="my-full-width">FW: {props.data?.info}</div>;
    };
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "400px", width: "600px" }}
        {...fullWidthOptions}
        fullWidthCellRenderer={SolidFullWidth}
        ref={(r) => (gridRef = r)}
      />
    ));

    await waitFor(() => container.querySelectorAll(".my-full-width").length >= 2);
    await settle();

    const before = container.querySelectorAll<HTMLElement>(".my-full-width")[0]!;
    expect(before.textContent).toBe("FW: wide-2");
    const mountsBefore = mountCount;

    // same row id, new data → rowModeFeature.refreshRow → IRowComp.refreshFullWidth →
    // prop-push through the details signal (reactiveCustomComponents default is on)
    gridRef.api.applyTransaction({ update: [{ id: "2", info: "wide-2-updated", wide: true }] });
    await waitFor(
      () => container.querySelectorAll(".my-full-width")[0]?.textContent === "FW: wide-2-updated",
    );

    // identity preserved: params flowed reactively into the live component
    expect(container.querySelectorAll<HTMLElement>(".my-full-width")[0]).toBe(before);
    expect(mountCount).toBe(mountsBefore);

    unmount();
  });

  it("embedded full-width (embedFullWidthRows + pinned column): per-lane renderers match vanilla lane structure", async () => {
    const embeddedOptions: GridOptions<InfoRow> = {
      ...fullWidthOptions,
      columnDefs: [{ field: "id", pinned: "left" }, { field: "info" }],
      embedFullWidthRows: true,
    };
    const vanilla = mountVanilla<InfoRow>({
      ...embeddedOptions,
      fullWidthCellRenderer: JsFullWidthRenderer,
    });
    // labels each lane instance with its pinned section so we can see three live instances
    const SolidFullWidth = (props: ICellRendererParams<InfoRow> & { pinned?: string | null }) => (
      <div class="my-full-width">{`FW(${props.pinned ?? "center"}): ${props.data?.info}`}</div>
    );
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "400px", width: "600px" }}
        {...embeddedOptions}
        fullWidthCellRenderer={SolidFullWidth}
      />
    ));

    await waitFor(() => container.querySelectorAll(".my-full-width").length >= 2);
    await waitFor(() => vanilla.container.querySelectorAll(".my-full-width").length >= 2);
    await settle();

    const fwRow = (root: Element) =>
      [...root.querySelectorAll<HTMLElement>(".ag-row.ag-full-width-row")].find(
        (row) => row.getAttribute("row-index") === "1",
      )!;
    const sRow = fwRow(container);
    const vRow = fwRow(vanilla.container);
    expect(sRow).toBeDefined();
    expect(vRow).toBeDefined();

    // lane parity: the renderer repeats once per rendered lane, in the same lane containers
    for (const lane of ["ag-grid-pinned-left-cells", "ag-grid-scrolling-cells"]) {
      const sLane = sRow.querySelector<HTMLElement>(`.${lane}`);
      const vLane = vRow.querySelector<HTMLElement>(`.${lane}`);
      expect(sLane, `solid lane ${lane}`).not.toBeNull();
      expect(vLane, `vanilla lane ${lane}`).not.toBeNull();
      expect(sLane!.querySelectorAll(".my-full-width").length, `renderers in ${lane}`).toBe(
        vLane!.querySelectorAll(".my-full-width").length,
      );
    }
    // Solid framework renderers received the per-lane pinned params
    expect(fwRow(container).textContent).toContain("FW(left): wide-2");
    expect(fwRow(container).textContent).toContain("FW(center): wide-2");
    // no plain full-width anchor in embedded mode
    expect(sRow.querySelector(".ag-full-width-anchor")).toBeNull();

    vanilla.destroy();
    unmount();
  });

  it("embedded full-width prop-push refresh updates every lane in place", async () => {
    let gridRef!: AgGridSolidRef<InfoRow>;
    const SolidFullWidth = (props: ICellRendererParams<InfoRow> & { pinned?: string | null }) => (
      <div class="my-full-width">{`FW(${props.pinned ?? "center"}): ${props.data?.info}`}</div>
    );
    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "400px", width: "600px" }}
        {...fullWidthOptions}
        columnDefs={[{ field: "id", pinned: "left" }, { field: "info" }]}
        embedFullWidthRows={true}
        fullWidthCellRenderer={SolidFullWidth}
        ref={(r) => (gridRef = r)}
      />
    ));

    await waitFor(() => container.querySelectorAll(".my-full-width").length >= 2);
    await settle();

    const row = [...container.querySelectorAll<HTMLElement>(".ag-row.ag-full-width-row")].find(
      (r) => r.getAttribute("row-index") === "1",
    )!;
    const lanesBefore = [...row.querySelectorAll<HTMLElement>(".my-full-width")];
    expect(lanesBefore.length).toBeGreaterThanOrEqual(2);

    gridRef.api.applyTransaction({ update: [{ id: "2", info: "updated", wide: true }] });
    await waitFor(() => row.textContent!.includes("FW(center): updated"));

    expect(row.textContent).toContain("FW(left): updated");
    const lanesAfter = [...row.querySelectorAll<HTMLElement>(".my-full-width")];
    // same elements, refreshed in place lane by lane
    expect(lanesAfter).toEqual(lanesBefore);

    unmount();
  });
});

describe("Nested AgGridSolid (Open question 6 verdict)", () => {
  it("a full-width renderer that mounts another AgGridSolid during the master's flush works with no reactivity diagnostics", async () => {
    // Master-detail is enterprise, but agDetailCellRenderer's nested grid takes exactly this
    // path: compProxy push during the master's setComp/flush → signal → nested <AgGridSolid>
    // component created inside the master's microtask batch, grid boot in the nested
    // onSettled. A community full-width renderer that renders another AgGridSolid exercises
    // the identical re-entrancy mechanism.
    const errorSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");

    let masterRef!: AgGridSolidRef<InfoRow>;
    let nestedRef!: AgGridSolidRef;
    const NestedGridRenderer = (props: ICellRendererParams<InfoRow>) => (
      <div class="nested-grid-holder" style={{ height: "150px", width: "500px" }}>
        <AgGridSolid
          columnDefs={[{ field: "callId" }, { field: "duration" }]}
          rowData={[
            { callId: `${props.data?.id}-a`, duration: 30 },
            { callId: `${props.data?.id}-b`, duration: 45 },
          ]}
          ref={(r) => (nestedRef = r)}
        />
      </div>
    );

    const { container, unmount } = render(() => (
      <AgGridSolid
        containerStyle={{ height: "400px", width: "600px" }}
        columnDefs={[{ field: "id" }, { field: "info" }]}
        rowData={infoRows.slice(0, 2)}
        getRowId={(params) => params.data.id}
        isFullWidthRow={(params) => !!params.rowNode.data?.wide}
        getRowHeight={(params) => (params.data?.wide ? 180 : undefined)}
        fullWidthCellRenderer={NestedGridRenderer}
        ref={(r) => (masterRef = r)}
      />
    ));

    // nested grid renders its own rows inside the master's full-width row
    await waitFor(
      () => container.querySelectorAll(".nested-grid-holder .ag-row").length >= 2,
      10000,
    );
    await settle();

    // master stays intact around the nested grid
    expect(masterRef.api.getDisplayedRowCount()).toBe(2);
    expect(container.querySelectorAll('.ag-cell[col-id="id"]').length).toBeGreaterThan(0);
    // nested grid is a fully working grid with its own api
    expect(nestedRef.api.getDisplayedRowCount()).toBe(2);
    const nestedCells = [
      ...container.querySelectorAll<HTMLElement>('.nested-grid-holder .ag-cell[col-id="callId"]'),
    ].map((c) => c.textContent);
    expect(nestedCells).toEqual(["2-a", "2-b"]);

    // master api still drives updates through the nested-grid row
    masterRef.api.applyTransaction({ update: [{ id: "1", info: "normal-1-upd", wide: false }] });
    await waitFor(() =>
      [...container.querySelectorAll('.ag-cell[col-id="info"]')].some(
        (c) => c.textContent === "normal-1-upd",
      ),
    );

    // THE VERDICT EVIDENCE: no Solid 2.0 reactivity diagnostics from creating a grid inside
    // another grid's render flush
    const diagnostics = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => call.join(" "))
      .filter((msg) =>
        /PENDING_ASYNC|REACTIVE_WRITE_IN_OWNED_SCOPE|REACTIVITY_HALTED|NotReadyError|STRICT_READ/.test(
          msg,
        ),
      );
    expect(diagnostics).toEqual([]);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
    unmount();
  });
});
