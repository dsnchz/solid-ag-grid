import type { Context, UserCompDetails } from "ag-grid-community";

/**
 * Shows a JS (non-framework) component from UserCompDetails inside eParent. Port of
 * reactUi/jsComp.tsx `showJsComp`; the React MutableRefObject overload collapses to a
 * callback-only ref.
 * @returns cleanup function, or undefined when nothing was mounted
 */
export const showJsComp = (
  compDetails: UserCompDetails | undefined | null,
  context: Context,
  eParent: HTMLElement,
  ref?: (instance: any) => void,
): (() => void) | undefined => {
  const doNothing = !compDetails || compDetails.componentFromFramework || context.isDestroyed();
  if (doNothing) {
    return undefined;
  }

  const promise = compDetails.newAgStackInstance();

  // almost all JS Comps are NOT async, however the Floating Multi Filter is Async as it could
  // be wrapping a framework filter, so we need to cater for async comps here.
  let comp: any;
  let compGui: HTMLElement | undefined;
  let destroyed = false;

  promise.then((c: any) => {
    if (destroyed) {
      context.destroyBean(c);
      return;
    }

    comp = c;
    compGui = comp.getGui?.();
    if (compGui) {
      eParent.appendChild(compGui);
    }
    ref?.(comp);
  });

  return () => {
    destroyed = true;
    if (!comp) {
      return; // in case we were destroyed before the async comp was returned
    }

    compGui?.remove();

    context.destroyBean(comp);

    ref?.(undefined);
  };
};
