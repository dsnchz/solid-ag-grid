import type { Context } from "solid-js";
import { createContext } from "solid-js";

/** Value of {@link CustomContext}: lets a custom component register the methods the grid calls on it. */
export type CustomContextParams<M> = {
  /** Registers the imperative methods (e.g. `getValue`, `doesFilterPass`) the grid may invoke. */
  setMethods: (methods: M) => void;
};

// carries a default (unlike BeansContext) so a custom component rendered outside the
// CustomWrapperComp shell degrades to a no-op instead of throwing — parity with React
// explicit type: JSR's public-API rule (no slow types) — keeps consumers' type-checking fast
/**
 * Context available inside custom components (cell editors, filters, ...) rendered by the grid;
 * exported as `CustomComponentContext` for ag-grid-react parity. The `useGrid*` hooks read it,
 * so most components never touch it directly.
 */
export const CustomContext: Context<CustomContextParams<any>> = createContext<
  CustomContextParams<any>
>({
  setMethods: () => {},
});
