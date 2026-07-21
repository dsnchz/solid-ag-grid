import type { BeanCollection } from "ag-grid-community";
import { createContext } from "solid-js";

// default-less on purpose: Solid 2.0 useContext throws ContextNotFoundError if no provider
// is mounted, which is the desired behavior for comps rendered outside a grid.
export const BeansContext = createContext<BeanCollection>();
