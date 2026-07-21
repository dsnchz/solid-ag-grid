import type { IRowContainerComp, RowContainerName, RowCtrl } from "ag-grid-community";
import {
  _getRowContainerClass,
  _getRowContainerOptions,
  _getRowSpanContainerClass,
  RowContainerCtrl,
} from "ag-grid-community";
import { createMemo, createSignal, For, onCleanup, onSettled, untrack, useContext } from "solid-js";

import { BeansContext } from "../core/beansContext";
import { insertDomComment } from "../core/domComment";
import { agFlush, classesList, getNextValueIfDifferent } from "../core/utils";
import RowComp from "./rowComp";

type RowContainerCompProps = {
  name: RowContainerName;
  viewportElement: HTMLElement;
  extraClassName?: string | null;
};

const RowContainerComp = (props: RowContainerCompProps) => {
  const { context, gos } = useContext(BeansContext);

  // name and viewportElement are stable for the life of the comp (name is a literal at every call
  // site; GridBodyComp's conditional remounts us if the viewport ever changed) and are read from
  // ref callbacks — capture once in the body (see the setComp verdict in gridComp.tsx)
  const name = untrack(() => props.name);
  const viewportElement = untrack(() => props.viewportElement);

  const containerOptions = _getRowContainerOptions(name);

  let eContainer: HTMLDivElement | undefined;
  let eSpanContainer: HTMLDivElement | undefined;
  let rowCtrlsRef: RowCtrl[] = [];
  let prevRowCtrlsRef: RowCtrl[] = [];
  const [hidden, setHidden] = createSignal(true);

  const [rowCtrlsOrdered, setRowCtrlsOrdered] = createSignal<RowCtrl[]>([]);

  const isSpanning = !!gos.get("enableCellSpan") && !!containerOptions.getSpannedRowCtrls;
  let spannedRowCtrlsRef: RowCtrl[] = [];
  let prevSpannedRowCtrlsRef: RowCtrl[] = [];
  const [spannedRowCtrlsOrdered, setSpannedRowCtrlsOrdered] = createSignal<RowCtrl[]>([]);

  let domOrder = false;
  let rowContainerCtrl: RowContainerCtrl | undefined;

  const containerClasses = createMemo(() =>
    classesList(_getRowContainerClass(name), hidden() ? "ag-hidden" : null, props.extraClassName),
  );
  const spanClasses = classesList("ag-spanning-container", _getRowSpanContainerClass(name));

  // refs fire before the template is parented, so the comment is inserted from onSettled
  onSettled(() => insertDomComment(` AG Row Container ${name} `, eContainer));

  const updateRowCtrlsOrdered = (useFlush: boolean) => {
    const next = getNextValueIfDifferent(prevRowCtrlsRef, rowCtrlsRef, domOrder)!;
    if (next !== prevRowCtrlsRef) {
      prevRowCtrlsRef = next;
      agFlush(useFlush, () => setRowCtrlsOrdered(next));
    }
  };

  const updateSpannedRowCtrlsOrdered = (useFlush: boolean) => {
    const next = getNextValueIfDifferent(prevSpannedRowCtrlsRef, spannedRowCtrlsRef, domOrder)!;
    if (next !== prevSpannedRowCtrlsRef) {
      prevSpannedRowCtrlsRef = next;
      agFlush(useFlush, () => setSpannedRowCtrlsOrdered(next));
    }
  };

  // guarded setup runs from the container ref and (when spanning) the span-container ref, and
  // fires once every element it needs exists (order-independent; see TabGuardComp.setupCtrl)
  const setup = () => {
    if (rowContainerCtrl || context.isDestroyed()) {
      return;
    }
    if (!eContainer || (isSpanning && !eSpanContainer)) {
      return;
    }

    const eContainerForCtrl = eContainer;
    const eSpanContainerForCtrl = eSpanContainer;

    const compProxy: IRowContainerComp = {
      setRowCtrls: ({ rowCtrls, useFlushSync }) => {
        const useFlush = !!useFlushSync && rowCtrlsRef.length > 0 && rowCtrls.length > 0;
        rowCtrlsRef = rowCtrls;
        updateRowCtrlsOrdered(useFlush);
      },
      setSpannedRowCtrls: (rowCtrls, useFlushSync) => {
        const useFlush = !!useFlushSync && spannedRowCtrlsRef.length > 0 && rowCtrls.length > 0;
        spannedRowCtrlsRef = rowCtrls;
        updateSpannedRowCtrlsOrdered(useFlush);
      },
      setDomOrder: (value) => {
        if (domOrder !== value) {
          domOrder = value;
          updateRowCtrlsOrdered(false);
        }
      },
      setContainerWidth: (width) => {
        eContainerForCtrl.style.width = width;
        if (eSpanContainerForCtrl) {
          eSpanContainerForCtrl.style.width = width;
        }
      },
      setOffsetTop: (offset) => {
        eContainerForCtrl.style.transform = `translateY(${offset})`;
        if (eSpanContainerForCtrl) {
          eSpanContainerForCtrl.style.transform = `translateY(${offset})`;
        }
      },
      setHidden: (value) => setHidden(value),
    };

    rowContainerCtrl = context.createBean(new RowContainerCtrl(name));
    rowContainerCtrl.setComp(
      compProxy,
      eContainerForCtrl,
      eSpanContainerForCtrl,
      viewportElement ?? eContainerForCtrl,
    );
  };

  onCleanup(() => {
    rowContainerCtrl = context.destroyBean(rowContainerCtrl);
  });

  const buildSpanContainer = () => (
    <div
      class={spanClasses}
      ref={(el) => {
        eSpanContainer = el;
        setup();
      }}
      role="presentation"
    >
      <For each={spannedRowCtrlsOrdered()}>
        {(rowCtrl) => <RowComp rowCtrl={rowCtrl} containerType={containerOptions.type} />}
      </For>
    </div>
  );

  return (
    <div
      class={containerClasses()}
      ref={(el) => {
        eContainer = el;
        setup();
      }}
      role="presentation"
    >
      {/* default <For> keys by ctrl reference == React key={instanceId} (ctrl identity is
          stable per instanceId); getNextValueIfDifferent already preserved DOM order */}
      <For each={rowCtrlsOrdered()}>
        {(rowCtrl) => <RowComp rowCtrl={rowCtrl} containerType={containerOptions.type} />}
      </For>
      {isSpanning ? buildSpanContainer() : null}
    </div>
  );
};

export default RowContainerComp;
