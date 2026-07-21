import type { JSX } from "@solidjs/web";
import type {
  Component,
  ComponentSelector,
  Context,
  FocusableContainer,
  IGridComp,
  TabGuardComp as JsTabGuardComp,
} from "ag-grid-community";
import { GridCtrl } from "ag-grid-community";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";

import { BeansContext } from "./core/beansContext";
import { insertDomComment } from "./core/domComment";
import { classesList } from "./core/utils";
import GridBodyComp from "./gridBodyComp";
import type { TabGuardRef } from "./tabGuardComp";
import TabGuardComp from "./tabGuardComp";

type GridCompProps = {
  context: Context;
};

type FocusableContainerComp = Component & FocusableContainer;
type HeaderDropZonesComp = Component & { getFocusableContainers?: () => FocusableContainerComp[] };

const GridComp = (props: GridCompProps) => {
  // captured ONCE, in the component body: props.context is signal-backed in the parent, and
  // ref callbacks run unowned (`runWithOwner(null)`) mid-flush, where signal reads return the
  // stale pre-flush value. Body-time capture runs inside the creating computation, which sees
  // the pending (new) value; `untrack` silences the dev strict-read warning. The grid never
  // swaps Context in place (the parent conditional remounts GridComp instead), so a one-shot
  // capture matches the React wrapper's `({ context }) => ...` destructure.
  const context = untrack(() => props.context);

  const [layoutClass, setLayoutClass] = createSignal<string>("");
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [userSelect, setUserSelect] = createSignal<string | null>(null);
  const [initialised, setInitialised] = createSignal<boolean>(false);
  const [tabGuardReady, setTabGuardReady] = createSignal<boolean>(false);
  // eGridBodyParent is a signal as we use it in render
  const [eGridBodyParent, setGridBodyParent] = createSignal<HTMLDivElement>();

  let gridCtrl: GridCtrl | undefined;
  let eRootWrapper: HTMLDivElement | undefined;
  let tabGuardRef: TabGuardRef | undefined;
  let paginationComp: JsTabGuardComp | undefined;
  let focusableContainers: FocusableContainerComp[] = [];

  const onTabKeyDown = () => undefined;

  // SETCOMP VERDICT (ARCHITECTURE.md Open question 1): ctrl.setComp runs directly in the ref
  // callback, exactly like the React wrapper. @solidjs/web applies refs via
  // `runWithOwner(null, ...)`, which clears the reactive context, and the dev-mode
  // REACTIVE_WRITE_IN_OWNED_SCOPE throw only fires while a computation context is active — so
  // the synchronous compProxy pushes setComp makes (LayoutFeature.postConstruct →
  // updateLayoutClasses → setLayoutClass) are legal signal writes; no `ownedWrite: true`,
  // `queueMicrotask` or onSettled deferral needed. The element being document-DISCONNECTED at
  // ref time (Solid refs fire before insertion) is fine here: GridCtrl.setComp only does
  // setAttribute / listener wiring / ResizeObserver.observe, none of which require
  // connectivity (unlike grid *creation* in agGridSolid.tsx, which stays in onSettled).
  // COROLLARY: ref callbacks may freely WRITE signals but must not READ signal-backed props —
  // unowned reads mid-flush return the stale committed value (see the `context` capture above).
  // Evidence for both halves: test/unit/setCompScopes.test.tsx.
  const setRef = (eRef: HTMLDivElement) => {
    eRootWrapper = eRef;
    if (context.isDestroyed()) {
      return;
    }

    gridCtrl = context.createBean(new GridCtrl());

    const compProxy: IGridComp = {
      destroyGridUi: () => {}, // do nothing, as framework users destroy grid by removing the comp
      forceFocusOutOfContainer: (up?: boolean) => {
        if (!up && paginationComp?.isDisplayed()) {
          paginationComp.forceFocusOutOfContainer(up);
          return;
        }
        tabGuardRef?.forceFocusOutOfContainer(up);
      },
      updateLayoutClasses: setLayoutClass,
      getFocusableContainers: () => {
        const beforeGridBody: FocusableContainer[] = [];
        const afterGridBody: FocusableContainer[] = [];
        const gridBodyCompEl = eRootWrapper?.querySelector(".ag-root");
        for (const comp of focusableContainers) {
          if (!comp.isDisplayed()) {
            continue;
          }

          const name = comp.getFocusableContainerName();
          if (name === "toolbar" || name === "rowGroupToolbar" || name === "pivotToolbar") {
            beforeGridBody.push(comp);
            continue;
          }

          afterGridBody.push(comp);
        }

        const comps: FocusableContainer[] = [...beforeGridBody];
        if (gridBodyCompEl) {
          comps.push({
            getGui: () => gridBodyCompEl as HTMLElement,
            getFocusableContainerName: () => "gridBody",
          });
        }
        comps.push(...afterGridBody);
        return comps;
      },
      setCursor,
      setUserSelect,
    };

    gridCtrl.setComp(compProxy, eRef);

    setInitialised(true);
  };

  onCleanup(() => {
    gridCtrl = context.destroyBean(gridCtrl);
  });

  // refs fire before the template is parented, so the comment is inserted from onSettled
  onSettled(() => insertDomComment(" AG Grid ", eRootWrapper));

  // initialise the extra (optional selector) components
  createEffect(
    () => (tabGuardReady() ? eGridBodyParent() : undefined),
    (eBodyParent) => {
      if (!eBodyParent || !gridCtrl || !eRootWrapper || context.isDestroyed()) {
        return;
      }

      const eRootWrapperEl = eRootWrapper;
      const beansToDestroy: Component[] = [];
      focusableContainers = [];
      paginationComp = undefined;

      // these components are optional, so we check if they are registered before creating them
      const {
        watermarkSelector,
        paginationSelector,
        sideBarSelector,
        statusBarSelector,
        toolbarSelector,
        gridHeaderDropZonesSelector,
      } = gridCtrl.getOptionalSelectors();
      const additionalEls: HTMLElement[] = [];

      const addComponentToDom = <T extends Component>(
        component: ComponentSelector<T>["component"],
        position: InsertPosition = "beforeend",
      ): T => {
        const comp = context.createBean(new component()) as T;
        const eGui = comp.getGui();
        eRootWrapperEl.insertAdjacentElement(position, eGui);
        additionalEls.push(eGui);
        beansToDestroy.push(comp);
        return comp;
      };

      if (toolbarSelector) {
        const toolbarComp = addComponentToDom(toolbarSelector.component, "afterbegin");
        focusableContainers.push(toolbarComp);
      }

      if (gridHeaderDropZonesSelector) {
        const headerDropZonesComp = context.createBean(
          new gridHeaderDropZonesSelector.component(),
        ) as HeaderDropZonesComp;
        const eGui = headerDropZonesComp.getGui();
        // Insert after toolbar (if present) or at the start
        const toolbar = eRootWrapperEl.querySelector(".ag-toolbar");
        if (toolbar) {
          toolbar.after(eGui);
        } else {
          eRootWrapperEl.prepend(eGui);
        }
        additionalEls.push(eGui);
        beansToDestroy.push(headerDropZonesComp);
        focusableContainers.push(...(headerDropZonesComp.getFocusableContainers?.() ?? []));
      }

      if (sideBarSelector) {
        const sideBarComp = context.createBean(new sideBarSelector.component());
        const eGui = sideBarComp.getGui();
        const bottomTabGuard = eBodyParent.querySelector(".ag-tab-guard-bottom");
        if (bottomTabGuard) {
          bottomTabGuard.insertAdjacentElement("beforebegin", eGui);
          additionalEls.push(eGui);
        }

        beansToDestroy.push(sideBarComp);
        focusableContainers.push(sideBarComp as FocusableContainerComp);
      }

      if (statusBarSelector) {
        const statusBarComp = addComponentToDom(statusBarSelector.component);
        focusableContainers.push(statusBarComp as FocusableContainerComp);
      }

      if (paginationSelector) {
        const pagination = addComponentToDom(paginationSelector.component);
        paginationComp = pagination as JsTabGuardComp;
        focusableContainers.push(pagination as FocusableContainerComp);
      }

      if (watermarkSelector) {
        addComponentToDom(watermarkSelector.component);
      }

      return () => {
        context.destroyBeans(beansToDestroy);
        focusableContainers = [];
        paginationComp = undefined;
        for (const el of additionalEls) {
          el.remove();
        }
      };
    },
  );

  const rootWrapperClasses = createMemo(() => classesList("ag-root-wrapper", layoutClass()));
  const rootWrapperBodyClasses = createMemo(() =>
    classesList("ag-root-wrapper-body", "ag-focus-managed", layoutClass()),
  );

  const topStyle = createMemo<JSX.CSSProperties>(() => ({
    "user-select": userSelect() != null ? (userSelect() as any) : "",
    "-webkit-user-select": userSelect() != null ? (userSelect() as any) : "",
    cursor: cursor() != null ? cursor()! : "",
  }));

  const setTabGuardCompRef = (ref: TabGuardRef) => {
    tabGuardRef = ref;
    setTabGuardReady(ref != null);
  };

  const isFocusable = () => !gridCtrl?.isFocusable();

  // we wait for initialised before rendering the children, so GridComp has created and
  // registered with its GridCtrl before we create the child GridBodyComp. Otherwise the
  // GridBodyComp would initialise first, before we have set the Layout CSS classes, causing
  // the GridBodyComp to render rows to a grid that doesn't have its height specified, which
  // would result in all the rows getting rendered (and if many rows, hangs the UI)
  const readyBodyParent = createMemo(() =>
    initialised() && !context.isDestroyed() ? eGridBodyParent() : undefined,
  );

  return (
    <div ref={setRef} class={rootWrapperClasses()} style={topStyle()} role="presentation">
      <div class={rootWrapperBodyClasses()} ref={setGridBodyParent} role="presentation">
        <Show when={readyBodyParent()}>
          {(eBodyParent) => (
            <BeansContext value={context.getBeans()}>
              <TabGuardComp
                ref={setTabGuardCompRef}
                eFocusableElement={eBodyParent()}
                onTabKeyDown={onTabKeyDown}
                gridCtrl={gridCtrl!}
                forceFocusOutWhenTabGuardsAreEmpty={true}
                isEmpty={isFocusable}
              >
                <GridBodyComp />
              </TabGuardComp>
            </BeansContext>
          )}
        </Show>
      </div>
    </div>
  );
};

export default GridComp;
