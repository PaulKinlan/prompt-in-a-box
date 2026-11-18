import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentBookmarkMutation } from '../events/mutation-guard';

export const bookmarkAdd = tool({
  description:
    'Create a new bookmark. Omit `parentId` to add to the default location ("Other Bookmarks"). Returns the new bookmark node.',
  inputSchema: z.object({
    title: z.string().min(1),
    url: z.string().url(),
    parentId: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
  }),
  execute: async ({ title, url, parentId, index }) => {
    markAgentBookmarkMutation(parentId ? [parentId] : [], { urls: [url] });

    try {
      const node = await chrome.bookmarks.create({ title, url, parentId, index });
      const urlsToMark = [url, node.url].filter((u): u is string => Boolean(u));
      markAgentBookmarkMutation([node.id], { urls: urlsToMark });

      await recordAction({
        toolName: 'bookmark_add',
        label: `Created bookmark: "${title}"`,
        detail: `URL: ${url}, ID: ${node.id}`,
        undo: {
          kind: 'bookmark_add',
          createdBookmarkId: node.id,
        },
      });

      return {
        ok: true,
        id: node.id,
        title: node.title,
        url: node.url ?? null,
        parentId: node.parentId ?? null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, parentId, error: msg };
      }
      return { ok: false, error: msg };
    }
  },
});
