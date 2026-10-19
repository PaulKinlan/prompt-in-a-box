import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

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
    const node = await chrome.bookmarks.create({ title, url, parentId, index });

    await recordAction({
      toolName: 'bookmark_add',
      label: `Created bookmark: "${title}"`,
      detail: `URL: ${url}, ID: ${node.id}`,
      undo: {
        kind: 'bookmark_add',
        createdBookmarkId: node.id,
      },
    });

    return { id: node.id, title: node.title, url: node.url ?? null, parentId: node.parentId ?? null };
  },
});
