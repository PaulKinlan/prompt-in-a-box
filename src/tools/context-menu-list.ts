import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs';

/**
 * Chrome doesn't expose an enumeration API for context menu items the
 * extension owns. We keep our own list via the `context_menu_*` tools
 * and mirror it to OPFS so the prompt can query its own registry.
 *
 * Items written here by other tools land in
 * `state/context-menu-index.json`. If nothing is stored yet, returns
 * an empty list.
 */
const INDEX_PATH = 'state/context-menu-index.json';

export const contextMenuList = tool({
  description:
    "List context menu items the agent has registered (tracked in an OPFS-backed registry; Chrome does not expose a query API for context menus).",
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const raw = await opfs.readText(INDEX_PATH);
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },
});
