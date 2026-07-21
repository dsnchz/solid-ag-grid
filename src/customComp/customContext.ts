import { createContext } from "solid-js";

type CustomContextParams<M> = {
  setMethods: (methods: M) => void;
};

// carries a default (unlike BeansContext) so a custom component rendered outside the
// CustomWrapperComp shell degrades to a no-op instead of throwing — parity with React
export const CustomContext = createContext<CustomContextParams<any>>({
  setMethods: () => {},
});
