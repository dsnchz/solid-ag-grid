import type { Context } from "solid-js";
import { createContext } from "solid-js";

type CustomContextParams<M> = {
  setMethods: (methods: M) => void;
};

// carries a default (unlike BeansContext) so a custom component rendered outside the
// CustomWrapperComp shell degrades to a no-op instead of throwing — parity with React
// explicit type: JSR's public-API rule (no slow types) — keeps consumers' type-checking fast
export const CustomContext: Context<CustomContextParams<any>> = createContext<
  CustomContextParams<any>
>({
  setMethods: () => {},
});
