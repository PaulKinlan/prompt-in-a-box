import { tool } from 'ai';
import { z } from 'zod';

/**
 * Context menu items the prompt creates are event sources for the
 * agent: clicks fire `chrome.contextMenus.onClicked`, which the events
 * dispatcher (src/events/dispatcher.ts) turns into immediate agent
 * runs with the click payload as context.
 *
 * So: creating a menu item IS registering a handler. The prompt
 * doesn't need to write an event listener; it just needs to know the
 * item id and decide what to do when the click event arrives.
 */
export const contextMenuCreate = tool({
  description:
    "Add an item to the right-click context menu. Clicks on this item will wake the agent and trigger a new run with the click event as context, so the prompt can handle it. Set `contexts` to control where the item appears (e.g. 'selection' only when text is selected).",
  inputSchema: z.object({
    id: z.string().min(1).describe('Stable identifier; used on clicks so the prompt can tell which item was picked.'),
    title: z.string().min(1),
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
          'launcher',
        ]),
      )
      .optional()
      .describe('Where the item appears. Default ["page"].'),
    parentId: z.string().optional(),
    type: z.enum(['normal', 'checkbox', 'radio', 'separator']).optional(),
    enabled: z.boolean().optional(),
    documentUrlPatterns: z.array(z.string()).optional(),
    targetUrlPatterns: z.array(z.string()).optional(),
  }),
  execute: async (opts) => {
    await new Promise<void>((resolve, reject) => {
      chrome.contextMenus.create(
        {
          id: opts.id,
          title: opts.title,
          contexts: opts.contexts ?? ['page'],
          parentId: opts.parentId,
          type: opts.type,
          enabled: opts.enabled,
          documentUrlPatterns: opts.documentUrlPatterns,
          targetUrlPatterns: opts.targetUrlPatterns,
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
