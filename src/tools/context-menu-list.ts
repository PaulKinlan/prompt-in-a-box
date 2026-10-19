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

export interface ContextMenuEntry {
  id: string;
  title?: string;
  contexts?: string[];
  parentId?: string;
  type?: string;
  enabled?: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
  checked?: boolean;
}

export async function readContextMenuIndex(): Promise<ContextMenuEntry[]> {
  try {
    const raw = await opfs.readText(INDEX_PATH);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function upsertContextMenuIndex(entry: ContextMenuEntry): Promise<void> {
  const current = await readContextMenuIndex();
  const existingIdx = current.findIndex((item) => item.id === entry.id);
  if (existingIdx >= 0) {
    current[existingIdx] = { ...current[existingIdx], ...entry };
  } else {
    current.push(entry);
  }
  await opfs.writeText(INDEX_PATH, JSON.stringify(current, null, 2));
}

export async function removeContextMenuIndex(opts: { id?: string; all?: boolean }): Promise<void> {
  if (opts.all) {
    await opfs.writeText(INDEX_PATH, JSON.stringify([], null, 2));
    return;
  }
  if (!opts.id) return;
  const current = await readContextMenuIndex();
  const next = current.filter((item) => item.id !== opts.id);
  await opfs.writeText(INDEX_PATH, JSON.stringify(next, null, 2));
}

export const contextMenuList = tool({
  description:
    "List context menu items the agent has registered (tracked in an OPFS-backed registry; Chrome does not expose a query API for context menus).",
  inputSchema: z.object({}),
  execute: async () => {
    return await readContextMenuIndex();
  },
});
