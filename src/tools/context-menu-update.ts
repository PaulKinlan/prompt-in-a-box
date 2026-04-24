import { tool } from 'ai';
import { z } from 'zod';

export const contextMenuUpdate = tool({
  description: 'Update a context menu item (title, enabled, contexts, etc.) by its id. Only fields you provide are changed.',
  inputSchema: z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    enabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    contexts: z
      .array(
        z.enum([
          'all',
          'page',
          'frame',
          'selection',
          'link',
          'editable',
          'image',
          'video',
          'audio',
          'page_action',
          'action',
        ]),
      )
      .optional(),
  }),
  execute: async (opts) => {
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.update(
        opts.id,
        {
          title: opts.title,
          enabled: opts.enabled,
          checked: opts.checked,
          contexts: opts.contexts,
        },
        () => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        },
      );
    });
    return { id: opts.id, ok: true };
  },
});
