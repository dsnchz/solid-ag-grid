import { createSignal, onSettled, untrack } from "solid-js";

import type { WrapperParams } from "./customComponentWrapper";
import { CustomContext } from "./customContext";

/**
 * Port of React's `CustomWrapperComp`: the shell the reactive custom-component system renders
 * around the user's component. Holds the pushed props and provides `setMethods` via
 * CustomContext.
 *
 * The pushed props live in a signal-of-object with a dynamic spread — NOT a store — for the
 * same reason as the portal entry props (see the portal identity verdict in portalManager.ts):
 * Solid 2.0 stores would deep-wrap the grid's class instances (api/node/column) in the params.
 */
// Non-generic (unlike React's <P, M>): the shell is only ever rendered through the
// type-erased portal boundary, so the concrete prop shape is Record<string, any> here.
const CustomWrapperComp = (params: WrapperParams<Record<string, any>, any>) => {
  // §7.1: capture signal-backed props once via untrack in the body (the shell arrives through
  // the portal props signal). initialProps never changes; its ref (patched in by
  // SolidComponent) is re-passed as a static ref attribute below so the custom component's
  // `props.ref(handle)` call never reads the pushed-props signal.
  const initialProps = untrack(() => params.initialProps);
  const [props, setProps] = createSignal<Record<string, any>>(initialProps);

  // Effect classification (§5.1, bridge category 2): registers the prop-push callback with
  // the non-Solid TS wrapper — React's mount-once useEffect analog. No async props are read
  // here, so no idempotence guard is needed (§7.9).
  onSettled(() => {
    // this allows the ts wrapper component to update the props passed into the custom component
    params.addUpdateCallback((newProps) => setProps(() => newProps));
  });

  return (
    <CustomContext value={{ setMethods: params.setMethods }}>
      <params.CustomComponentClass {...props()} ref={initialProps.ref} />
    </CustomContext>
  );
};

export default CustomWrapperComp;
