// SolidComponent + PortalManager + CustomComponentWrapper (T3.6): the bridge that lets the
// grid core (JS code) instantiate user-registered Solid components through portals. These
// tests drive the classes directly against the real GridPortals render loop (the same
// component the entry mounts), with no grid core involved — the browser suite covers the
// end-to-end parity oracle.
import { render } from "@solidjs/testing-library";
import type { ComponentType } from "ag-grid-community";
import { createContext, onCleanup, useContext } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import GridPortals from "../../src/core/gridPortals";
import { PortalManager } from "../../src/core/portalManager";
import type { UserSolidComponent } from "../../src/core/solidComponent";
import { SolidComponent } from "../../src/core/solidComponent";
import { CustomComponentWrapper } from "../../src/customComp/customComponentWrapper";
import { CustomContext } from "../../src/customComp/customContext";
import { getInstance } from "../../src/customComp/util";

const cellRendererType: ComponentType = { name: "cellRenderer", cellRenderer: true };
const overlayType: ComponentType = { name: "loadingOverlayComponent" };

const waitFor = async (cond: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

/** Mounts the production portal render loop for a manager. */
const mountPortalHost = (portalManager: PortalManager) =>
  render(() => <GridPortals portalManager={portalManager} />);

/** awaits an AgPromise (thenable but not a real Promise) */
const agPromiseToPromise = <T,>(agPromise: { then: (fn: (value: T) => void) => void }) =>
  new Promise<T>((resolve) => agPromise.then(resolve));

describe("SolidComponent portals (jsdom)", () => {
  it("init renders the user comp into div.ag-solid-container and resolves once rendered", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const UserComp: UserSolidComponent = (props) => (
      <span class="my-comp">{`value=${props.value}`}</span>
    );
    const comp = new SolidComponent(UserComp, portalManager, cellRendererType);
    const initPromise = comp.init({ value: 42 });

    const resolved = await agPromiseToPromise(initPromise);
    expect(resolved).toBe(comp);
    expect(comp.rendered()).toBe(true);

    const eGui = comp.getGui();
    expect(eGui.tagName).toBe("DIV");
    expect(eGui.classList.contains("ag-solid-container")).toBe(true);
    expect(eGui.textContent).toBe("value=42");
    // getRootElement skips the Portal marker text nodes
    expect(comp.getRootElement().className).toBe("my-comp");

    comp.destroy();
  });

  it("honors componentWrappingElement for the wrapping element", async () => {
    const portalManager = new PortalManager("span");
    mountPortalHost(portalManager);

    const comp = new SolidComponent(() => <b>x</b>, portalManager, cellRendererType);
    await agPromiseToPromise(comp.init({}));
    expect(comp.getGui().tagName).toBe("SPAN");
    comp.destroy();
  });

  it("props.ref(handle) becomes the framework component instance: hasMethod/callMethod/addMethod", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const myMethod = vi.fn().mockReturnValue("called");
    const UserComp: UserSolidComponent = (props) => {
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref({ myMethod });
      return <span>with-ref</span>;
    };
    const comp = new SolidComponent(UserComp, portalManager, overlayType, true);
    await agPromiseToPromise(comp.init({}));

    expect(comp.getFrameworkComponentInstance()).toEqual({ myMethod });
    expect(comp.hasMethod("myMethod")).toBe(true);
    expect(comp.hasMethod("nope")).toBe(false);

    const result = comp.callMethod("myMethod", ["a", "b"] as unknown as IArguments);
    expect(result).toBe("called");
    expect(myMethod).toHaveBeenCalledWith("a", "b");

    // addMethod attaches grid-core method proxies onto the wrapper itself
    const added = vi.fn();
    comp.addMethod("added", added);
    (comp as unknown as { added: () => void }).added();
    expect(added).toHaveBeenCalledTimes(1);

    comp.destroy();
  });

  it("callMethod retries on a timer while the instance is pending", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const late = vi.fn();
    const UserComp: UserSolidComponent = (props) => {
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref({ late });
      return <span>late-ref</span>;
    };
    const comp = new SolidComponent(UserComp, portalManager, overlayType, true);
    comp.init({});

    // called before the portal flush applied → no instance yet → queued via setTimeout retries
    comp.callMethod("late", [] as unknown as IArguments);
    expect(late).not.toHaveBeenCalled();
    await waitFor(() => late.mock.calls.length === 1);

    comp.destroy();
  });

  it("fallback refresh: refreshComponent pushes new props through the live portal entry — no remount, element identity preserved", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    let disposals = 0;
    const UserComp: UserSolidComponent = (props) => {
      onCleanup(() => disposals++);
      return <span class="refresh-me">{`v=${props.value}`}</span>;
    };
    // cellRenderer type → suppressFallbackMethods false → refresh falls back to refreshComponent
    const comp = new SolidComponent(UserComp, portalManager, cellRendererType, false);
    await agPromiseToPromise(comp.init({ value: 1 }));

    // a comp without an instance refresh method still reports refresh via the fallback
    expect(comp.hasMethod("refresh")).toBe(true);

    const elementBefore = comp.getRootElement();
    expect(elementBefore.textContent).toBe("v=1");

    comp.callMethod("refresh", [{ value: 2 }] as unknown as IArguments);
    await waitFor(() => comp.getRootElement()?.textContent === "v=2");

    // identity-preserving: the same DOM element updated in place, the comp never re-ran
    expect(comp.getRootElement()).toBe(elementBefore);
    expect(disposals).toBe(0);

    comp.destroy();
  });

  it("suppressFallbackMethods disables the refresh fallback", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const comp = new SolidComponent(() => <i>x</i>, portalManager, overlayType, true);
    await agPromiseToPromise(comp.init({}));
    expect(comp.hasMethod("refresh")).toBe(false);
    comp.destroy();
  });

  it("waitForInstance: destroyed manager resolves null; timeout path stays silent and kicks flush()", async () => {
    // no host rendered → the portal can never render
    const destroyedManager = new PortalManager(undefined, 40);
    const comp1 = new SolidComponent(() => <i>x</i>, destroyedManager, overlayType);
    destroyedManager.destroy();
    const resolved = await agPromiseToPromise(comp1.init({}));
    expect(resolved).toBeNull();

    const errorSpy = vi.spyOn(console, "error");
    const warnSpy = vi.spyOn(console, "warn");
    const silentManager = new PortalManager(undefined, 40);
    const comp2 = new SolidComponent(() => <i>y</i>, silentManager, overlayType);
    const init = vi.fn();
    comp2.init({}).then(init);
    // past maxComponentCreationTimeMs the manager flushes as a last resort, then gives up
    // silently — the init promise stays pending (React parity)
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(init).not.toHaveBeenCalled();
    expect(comp2.rendered()).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("a comp that never calls props.ref resolves as the stateless analog and routes callMethod to fallbacks", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const UserComp: UserSolidComponent = (props) => <span>{`plain-${props.value}`}</span>;
    const comp = new SolidComponent(UserComp, portalManager, cellRendererType, false);
    await agPromiseToPromise(comp.init({ value: "a" }));

    expect(comp.getFrameworkComponentInstance()).toBeUndefined();
    // stateless analog settled → refresh goes straight to the fallback prop push
    comp.callMethod("refresh", [{ value: "b" }] as unknown as IArguments);
    await waitFor(() => comp.getGui().textContent === "plain-b");

    comp.destroy();
  });

  it("destroy removes the portal, unmounts the comp and calls the instance destroy", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const destroySpy = vi.fn();
    let cleanedUp = false;
    const UserComp: UserSolidComponent = (props) => {
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref({ destroy: destroySpy });
      onCleanup(() => (cleanedUp = true));
      return <span>bye</span>;
    };
    const comp = new SolidComponent(UserComp, portalManager, overlayType);
    await agPromiseToPromise(comp.init({}));
    expect(portalManager.getPortals().length).toBe(1);
    expect(comp.getGui().textContent).toBe("bye");

    comp.destroy();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    // the portals signal write applies on the microtask batch
    await waitFor(() => portalManager.getPortals().length === 0);
    await waitFor(() => cleanedUp);
    // no leaked DOM in the wrapping element
    expect(comp.getGui().childElementCount).toBe(0);
  });

  it("user context above the portal host propagates into portal-rendered comps", async () => {
    const UserContext = createContext<string>();
    const portalManager = new PortalManager();
    render(() => (
      <UserContext value="from-above">
        <GridPortals portalManager={portalManager} />
      </UserContext>
    ));

    const ContextReader: UserSolidComponent = () => {
      const value = useContext(UserContext);
      return <span class="ctx">{value}</span>;
    };
    const comp = new SolidComponent(ContextReader, portalManager, overlayType);
    await agPromiseToPromise(comp.init({}));
    expect(comp.getGui().textContent).toBe("from-above");

    comp.destroy();
  });
});

describe("CustomComponentWrapper (jsdom)", () => {
  type TestParams = { value: number };
  type TestMethods = { customMethod?: () => string };

  class TestWrapper extends CustomComponentWrapper<TestParams, TestParams, TestMethods> {
    protected override getOptionalMethods(): string[] {
      return ["customMethod"];
    }

    public refresh(params: TestParams) {
      this.sourceParams = params;
      return this.refreshProps();
    }
  }

  it("renders the CustomWrapperComp shell, provides setMethods via CustomContext and attaches optional methods", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const CustomComp: UserSolidComponent = (props) => {
      const { setMethods } = useContext(CustomContext);
      setMethods({ customMethod: () => `custom-${props.value}` });
      return <span class="custom">{`v=${props.value}`}</span>;
    };
    const wrapper = new TestWrapper(CustomComp, portalManager, overlayType);
    await agPromiseToPromise(wrapper.init({ value: 5 }));

    expect(wrapper.getGui().textContent).toBe("v=5");
    expect(wrapper.getFrameworkComponentInstance()).toBe(wrapper);
    // setMethods flowed through CustomContext and customMethod is listed as optional
    expect((wrapper as unknown as { customMethod: () => string }).customMethod()).toBe("custom-5");

    wrapper.destroy();
  });

  it("refreshProps pushes new props into the live component without remounting it", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    let runs = 0;
    const CustomComp: UserSolidComponent = (props) => {
      runs++;
      return <span class="pushed">{`v=${props.value}`}</span>;
    };
    const wrapper = new TestWrapper(CustomComp, portalManager, overlayType);
    await agPromiseToPromise(wrapper.init({ value: 1 }));
    const elementBefore = wrapper.getRootElement();

    await agPromiseToPromise(wrapper.refresh({ value: 2 }));
    expect(wrapper.getGui().textContent).toBe("v=2");
    expect(wrapper.getRootElement()).toBe(elementBefore);
    expect(runs).toBe(1);

    wrapper.destroy();
  });

  it("refreshProps called before the update callback registers awaits registration (early-refresh path)", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const CustomComp: UserSolidComponent = (props) => <span>{`v=${props.value}`}</span>;
    const wrapper = new TestWrapper(CustomComp, portalManager, overlayType);
    wrapper.init({ value: 1 });

    // refresh immediately — before the shell's onSettled ran addUpdateCallback
    const refreshed = vi.fn();
    agPromiseToPromise(wrapper.refresh({ value: 3 })).then(refreshed);
    expect(refreshed).not.toHaveBeenCalled();
    await waitFor(() => refreshed.mock.calls.length === 1);
    expect(wrapper.getGui().textContent).toBe("v=3");

    wrapper.destroy();
  });

  it("getInstance resolves the handle the custom comp registered via props.ref", async () => {
    const portalManager = new PortalManager();
    mountPortalHost(portalManager);

    const handle = { customMethod: () => "handle" };
    const CustomComp: UserSolidComponent = (props) => {
      // eslint-disable-next-line solid/reactivity -- props.ref(handle) is the imperative-handle idiom; ref is a static merge source (plugin predates Solid 2.0)
      props.ref(handle);
      return <span>with-handle</span>;
    };
    const wrapper = new TestWrapper(CustomComp, portalManager, overlayType);
    await agPromiseToPromise(wrapper.init({ value: 1 }));

    const instance = await agPromiseToPromise(wrapper.getInstance());
    expect(instance).toBe(handle);

    // the public helper unwraps the same way
    const viaHelper = await new Promise((resolve) => {
      getInstance(wrapper as never, resolve);
    });
    expect(viaHelper).toBe(handle);

    wrapper.destroy();
  });
});
