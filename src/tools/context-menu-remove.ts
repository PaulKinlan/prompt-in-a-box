import { tool } from 'ai';
import { z } from 'zod';

export const contextMenuRemove = tool({
  description: 'Remove a single context menu item by id, or all items the extension owns when `all` is true.',
  inputSchema: z.object({
    id: z.string().optional(),
    all: z.boolean().optional(),
  }),
  execute: async ({ id, all }) => {
    if (all) {
      await new Promise<void>((resolve, reject) => {
        chrome.contextMenus.removeAll(() => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
      return { ok: true, removed: 'all' };
    }
    if (!id) return { error: 'either `id` or `all: true` is required' };
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.remove(id, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
    return { ok: true, id };
  },
});
