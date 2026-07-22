import "./app.css";

import { render } from "@solidjs/web";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";

import { App } from "./App";

// AG Grid v33+ modular registration — AllCommunityModule enables every community feature.
ModuleRegistry.registerModules([AllCommunityModule]);

render(() => <App />, document.getElementById("root")!);
