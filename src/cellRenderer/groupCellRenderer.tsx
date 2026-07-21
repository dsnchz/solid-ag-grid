import type {
  GroupCellRendererParams,
  ICellRenderer,
  IGroupCellRenderer,
  IGroupCellRendererCtrl,
  UserCompDetails,
} from "ag-grid-community";
import { _toString, CssClassManager } from "ag-stack";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  untrack,
  useContext,
} from "solid-js";

import { BeansContext } from "../core/beansContext";
import { showJsComp } from "../core/jsComp";
import { classesList, CssClasses } from "../core/utils";

type GroupCellRendererProps = GroupCellRendererParams & {
  readonly ref?: (handle: ICellRenderer) => void;
};

/**
 * Framework implementation of `agGroupCellRenderer` / `agGroupRowRenderer`. Port of
 * reactUi/cellRenderer/groupCellRenderer.tsx: drives an `IGroupCellRendererCtrl` created via
 * `registry.createDynamicBean('groupCellRendererCtrl')` (enterprise modules register it —
 * RowGrouping / Pivot / TreeData / MasterDetail / ServerSideRowModel).
 */
const GroupCellRenderer = (props: GroupCellRendererProps) => {
  const { registry, context } = useContext(BeansContext);

  // props arrive through the reactive params spread of CellComp / RowComp (§7.1: neither refs
  // nor the grid core may read signal-backed props mid-flush) — snapshot once in the body.
  // A static snapshot is faithful: our refresh() handle returns false, so every params change
  // remounts this component with fresh props (same per-mount props contract as React).
  const params = untrack(() => ({ ...props })) as GroupCellRendererProps;

  const [innerCompDetails, setInnerCompDetails] = createSignal<UserCompDetails>();
  const [childCount, setChildCount] = createSignal<string>();
  const [value, setValue] = createSignal<any>();
  // the three child spans are written only through the compProxy below, so reactive class
  // strings are safe for them (unlike the root — see cssManager)
  const [expandedCssClasses, setExpandedCssClasses] = createSignal<CssClasses>(
    new CssClasses("ag-hidden"),
  );
  const [expandedAriaHidden, setExpandedAriaHidden] = createSignal<boolean>(true);
  const [contractedCssClasses, setContractedCssClasses] = createSignal<CssClasses>(
    new CssClasses("ag-hidden"),
  );
  const [contractedAriaHidden, setContractedAriaHidden] = createSignal<boolean>(true);
  const [checkboxCssClasses, setCheckboxCssClasses] = createSignal<CssClasses>(
    new CssClasses("ag-invisible"),
  );
  const [checkboxAriaHidden, setCheckboxAriaHidden] = createSignal<boolean>(true);

  let eGui: HTMLElement | undefined;
  let eValue: HTMLElement | undefined;
  let eCheckbox: HTMLElement | undefined;
  let eExpanded: HTMLElement | undefined;
  let eContracted: HTMLElement | undefined;
  let ctrl: IGroupCellRendererCtrl | undefined;

  // root classes stay off the reactive graph (T3.9 finding): the ctrl pushes through toggleCss
  // and enterprise ctrl code may write to eGui.classList imperatively — a wholesale reactive
  // class binding would clobber those. Static base class + CssClassManager, like vanilla.
  const cssManager = new CssClassManager(() => eGui);

  params.ref?.({
    // force new instance when grid tries to refresh
    refresh: () => false,
  });

  // ctrl.init needs all four elements; refs apply in template order, so the guarded setup runs
  // from every ref and fires once (order-independent — HeaderGroupCellComp precedent)
  const setup = () => {
    if (!eGui || !eCheckbox || !eExpanded || !eContracted || ctrl) {
      return;
    }
    if (context.isDestroyed()) {
      return;
    }

    const compProxy: IGroupCellRenderer = {
      setInnerRenderer: (details, valueToDisplay) => {
        setInnerCompDetails(details);
        setValue(() => valueToDisplay);
      },
      setChildCount: (count) => setChildCount(count),
      toggleCss: (name, on) => cssManager.toggleCss(name, on),
      setContractedDisplayed: (displayed) => {
        setContractedCssClasses((prev) => prev.setClass("ag-hidden", !displayed));
        setContractedAriaHidden(!displayed);
      },
      setExpandedDisplayed: (displayed) => {
        setExpandedCssClasses((prev) => prev.setClass("ag-hidden", !displayed));
        setExpandedAriaHidden(!displayed);
      },
      setCheckboxVisible: (visible) => {
        setCheckboxCssClasses((prev) => prev.setClass("ag-invisible", !visible));
        setCheckboxAriaHidden(!visible);
      },
      setCheckboxSpacing: (add) =>
        setCheckboxCssClasses((prev) => prev.setClass("ag-group-checkbox-spacing", add)),
    };

    const groupCellRendererCtrl = registry.createDynamicBean<IGroupCellRendererCtrl>(
      "groupCellRendererCtrl",
      true,
    );
    if (groupCellRendererCtrl) {
      ctrl = context.createBean(groupCellRendererCtrl);
      ctrl.init(
        compProxy,
        eGui,
        eCheckbox,
        eExpanded,
        eContracted,
        GroupCellRenderer,
        params as GroupCellRendererParams,
      );
      // if there is no ColDef, this is a Full Width Group row and the cell aria role comes
      // from the ctrl (React re-renders to pick this up; we set it imperatively once)
      if (!params.colDef) {
        eGui.setAttribute("role", ctrl.getCellAriaRole());
      }
    }
  };

  onCleanup(() => {
    ctrl = context.destroyBean(ctrl);
  });

  // signal-keyed lifecycle of a non-Solid instance (§5.1 bridge category 2): mount/destroy the
  // JS inner renderer whenever the ctrl pushes new comp details (React: useLayoutEffect)
  createEffect(
    () => innerCompDetails(),
    (details) => showJsComp(details, context, eValue!),
  );

  const expandedClassName = createMemo(() =>
    classesList("ag-group-expanded", expandedCssClasses().toString()),
  );
  const contractedClassName = createMemo(() =>
    classesList("ag-group-contracted", contractedCssClasses().toString()),
  );
  const checkboxClassName = createMemo(() =>
    classesList("ag-group-checkbox", checkboxCssClasses().toString()),
  );

  // inner framework (Solid) renderers render inline as derived JSX (T3.9 pattern)
  const innerFrameworkComp = () => {
    const details = innerCompDetails();
    if (!details?.componentFromFramework) {
      return null;
    }
    const UserCompClass = details.componentClass;
    return <UserCompClass {...details.params} />;
  };

  const showValue = createMemo(() => innerCompDetails() == null && value() != null);

  return (
    <span
      class="ag-cell-wrapper"
      ref={(el) => {
        eGui = el;
        setup();
      }}
    >
      <span
        class={expandedClassName()}
        ref={(el) => {
          eExpanded = el;
          setup();
        }}
        aria-hidden={expandedAriaHidden() ? "true" : "false"}
      />
      <span
        class={contractedClassName()}
        ref={(el) => {
          eContracted = el;
          setup();
        }}
        aria-hidden={contractedAriaHidden() ? "true" : "false"}
      />
      <span
        class={checkboxClassName()}
        ref={(el) => {
          eCheckbox = el;
          setup();
        }}
        aria-hidden={checkboxAriaHidden() ? "true" : "false"}
      />
      <span class="ag-group-value" ref={(el) => (eValue = el)}>
        <Show when={showValue()}>{_toString(value())}</Show>
        {innerFrameworkComp()}
      </span>
      <span class="ag-group-child-count">{childCount()}</span>
    </span>
  );
};

export default GroupCellRenderer;
