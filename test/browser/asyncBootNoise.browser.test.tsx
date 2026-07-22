// Pins the fix for the dogfooding MEDIUM finding: booting a grid with a pending async
// prop must NOT log Solid's PENDING_ASYNC_FORBIDDEN_SCOPE dev warning (creation-time
// snapshot reads go through latest(), bypassing the pending-link machinery), while the
// zero-ceremony async rowData contract still holds end to end.
import { render } from "@solidjs/testing-library";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { createMemo } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import AgGridSolid from "../../src/index";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { readonly a: string };

describe("async boot console noise", () => {
  it("boots with pending async rowData without PENDING_ASYNC warnings, then resolves", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    const rows = createMemo(
      async (): Promise<Row[]> => new Promise((r) => setTimeout(() => r([{ a: "hello" }]), 40)),
    );

    const { container } = render(() => (
      <div style={{ height: "300px" }}>
        <AgGridSolid columnDefs={[{ field: "a" }]} rowData={rows()} />
      </div>
    ));

    await vi.waitFor(() => {
      expect(container.textContent).toContain("hello");
    });

    const noisy = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .filter((arg) => typeof arg === "string" && arg.includes("PENDING_ASYNC"));
    expect(noisy).toEqual([]);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
