import type { Context, ICellRendererComp, UserCompDetails } from "ag-grid-community";
import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { createJsCellRenderer } from "../../src/cells/createJsCellRenderer";
import type { RenderDetails } from "../../src/cells/interfaces";

/** AgPromise resolves synchronously when already settled — mimic that (thenable, not Promise). */
const syncThenable = <T,>(value: T) => ({
  then: (cb: (v: T) => void) => cb(value),
});

interface TestParams {
  value: unknown;
}

class TestJsRenderer implements ICellRendererComp {
  public eGui = document.createElement("span");
  public params: TestParams;
  public destroyed = false;
  constructor(params: TestParams) {
    this.params = params;
    this.eGui.className = "test-js-renderer";
    this.eGui.textContent = String(params.value);
  }
  getGui() {
    return this.eGui;
  }
  refresh(params: TestParams): boolean {
    this.params = params;
    this.eGui.textContent = String(params.value);
    return true;
  }
}

const makeContext = () => {
  const destroyed: unknown[] = [];
  const context = {
    isDestroyed: () => false,
    destroyBean: (bean: { destroyed?: boolean } | undefined) => {
      if (bean) {
        destroyed.push(bean);
        bean.destroyed = true;
      }
      return undefined;
    },
  } as unknown as Context;
  return { context, destroyed };
};

/** compDetails whose newAgStackInstance creates a TestJsRenderer (sync AgPromise semantics). */
const makeCompDetails = (
  value: unknown,
  created: TestJsRenderer[],
  opts: { componentFromFramework?: boolean; withRefresh?: boolean; async?: boolean } = {},
): UserCompDetails => {
  const { componentFromFramework = false, withRefresh = true } = opts;
  return {
    componentFromFramework,
    componentClass: TestJsRenderer,
    params: { value },
    newAgStackInstance: () => {
      const comp = new TestJsRenderer({ value });
      if (!withRefresh) {
        (comp as { refresh?: unknown }).refresh = undefined;
      }
      created.push(comp);
      return syncThenable(comp);
    },
  } as unknown as UserCompDetails;
};

const setup = () => {
  const { context, destroyed } = makeContext();
  const created: TestJsRenderer[] = [];
  const [details, setDetails] = createSignal<RenderDetails>();
  const [suppress, setSuppress] = createSignal(false);

  let renderer!: ReturnType<typeof createJsCellRenderer>;
  const dispose = createRoot((d) => {
    renderer = createJsCellRenderer({ context, renderDetails: details, suppress });
    return d;
  });
  flush();
  return { context, destroyed, created, setDetails, setSuppress, renderer, dispose };
};

describe("createJsCellRenderer (JS renderer lifecycle)", () => {
  it("creates the renderer for JS compDetails and exposes gui + instance", () => {
    const t = setup();
    expect(t.renderer.gui()).toBeUndefined();

    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();

    expect(t.created).toHaveLength(1);
    expect(t.renderer.instance()).toBe(t.created[0]);
    expect(t.renderer.gui()).toBe(t.created[0]!.eGui);
    expect(t.renderer.gui()!.textContent).toBe("a");
    t.dispose();
  });

  it("does nothing for framework compDetails or missing details", () => {
    const t = setup();
    t.setDetails({
      compDetails: makeCompDetails("a", t.created, { componentFromFramework: true }),
      value: "a",
      force: false,
    });
    flush();
    expect(t.created).toHaveLength(0);
    expect(t.renderer.gui()).toBeUndefined();
    t.dispose();
  });

  it("refresh path: new details with force:false refresh the live instance (no recreate)", () => {
    const t = setup();
    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();
    const first = t.renderer.instance()!;
    const refreshSpy = vi.spyOn(first, "refresh");

    t.setDetails({ compDetails: makeCompDetails("b", t.created), value: "b", force: false });
    flush();

    // the renderer survived the re-apply: refresh() was called, no new instance was created
    expect(refreshSpy).toHaveBeenCalledWith({ value: "b" });
    expect(t.renderer.instance()).toBe(first);
    expect(t.created).toHaveLength(1);
    expect(t.renderer.gui()!.textContent).toBe("b");
    expect(t.destroyed).toHaveLength(0);
    t.dispose();
  });

  it("recreates when refresh returns false", () => {
    const t = setup();
    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();
    const first = t.renderer.instance()!;
    vi.spyOn(first, "refresh").mockReturnValue(false);

    t.setDetails({ compDetails: makeCompDetails("b", t.created), value: "b", force: false });
    flush();

    expect(t.destroyed).toContain(first);
    expect(t.created).toHaveLength(2);
    expect(t.renderer.instance()).toBe(t.created[1]);
    t.dispose();
  });

  it("recreates without calling refresh when force:true", () => {
    const t = setup();
    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();
    const first = t.renderer.instance()!;
    const refreshSpy = vi.spyOn(first, "refresh");

    t.setDetails({ compDetails: makeCompDetails("b", t.created), value: "b", force: true });
    flush();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(t.destroyed).toContain(first);
    expect(t.renderer.instance()).toBe(t.created[1]);
    t.dispose();
  });

  it("recreates when the renderer has no refresh method", () => {
    const t = setup();
    t.setDetails({
      compDetails: makeCompDetails("a", t.created, { withRefresh: false }),
      value: "a",
      force: false,
    });
    flush();
    const first = t.renderer.instance()!;

    t.setDetails({
      compDetails: makeCompDetails("b", t.created, { withRefresh: false }),
      value: "b",
      force: false,
    });
    flush();

    expect(t.destroyed).toContain(first);
    expect(t.created).toHaveLength(2);
    t.dispose();
  });

  it("destroys the renderer when details go away and when suppressed (inline edit)", () => {
    const t = setup();
    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();
    const first = t.renderer.instance()!;

    t.setSuppress(true);
    flush();
    expect(t.destroyed).toContain(first);
    expect(t.renderer.instance()).toBeUndefined();
    expect(t.renderer.gui()).toBeUndefined();

    t.setSuppress(false);
    flush();
    // recreated after suppression lifts
    expect(t.created).toHaveLength(2);

    t.setDetails(undefined);
    flush();
    expect(t.destroyed).toContain(t.created[1]);
    expect(t.renderer.gui()).toBeUndefined();
    t.dispose();
  });

  it("disposal destroys the live renderer (onCleanup path)", () => {
    const t = setup();
    t.setDetails({ compDetails: makeCompDetails("a", t.created), value: "a", force: false });
    flush();
    const first = t.renderer.instance()!;

    t.dispose();
    expect(t.destroyed).toContain(first);
  });

  it("stale async instantiation is discarded (idempotence guard)", () => {
    const t = setup();
    // an async newAgStackInstance that resolves only when we say so
    let resolveComp!: (comp: TestJsRenderer) => void;
    const asyncDetails = {
      componentFromFramework: false,
      componentClass: TestJsRenderer,
      params: { value: "slow" },
      newAgStackInstance: () => ({
        then: (cb: (comp: TestJsRenderer) => void) => {
          resolveComp = cb;
        },
      }),
    } as unknown as UserCompDetails;

    t.setDetails({ compDetails: asyncDetails, value: "slow", force: false });
    flush();
    const staleResolve = resolveComp;

    // details change away before the async comp arrives
    t.setDetails(undefined);
    flush();

    const stale = new TestJsRenderer({ value: "slow" });
    staleResolve(stale);
    // the late arrival was destroyed, not adopted
    expect(t.destroyed).toContain(stale);
    expect(t.renderer.instance()).toBeUndefined();
    expect(t.renderer.gui()).toBeUndefined();
    t.dispose();
  });
});
