import { Portal } from "@solidjs/web";
import { For } from "solid-js";

import type { PortalManager } from "./portalManager";

/**
 * Renders the grid's user-component portals (React: `{portalManager.getPortals()}` in the
 * entry). <For> keys entries by PortalInfo object identity and the props flow through a
 * dynamic spread of the entry's props signal — both halves of the portal identity verdict
 * (see portalManager.ts). The ref attribute AFTER the spread makes `props.ref` resolve from
 * a static merge source (info is a raw <For> item), keeping user `props.ref(handle)` calls
 * off the props signal (§7.1 — see PortalInfo.ref).
 */
const GridPortals = (props: { portalManager: PortalManager }) => {
  return (
    <For each={props.portalManager.getPortals()}>
      {(info) => (
        <Portal mount={info.mount}>
          <info.SolidClass {...info.props()} ref={info.ref} />
        </Portal>
      )}
    </For>
  );
};

export default GridPortals;
