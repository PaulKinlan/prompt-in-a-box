import { tool } from 'ai';
import { z } from 'zod';

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
    return { id: node.id, title: node.title, url: node.url ?? null, parentId: node.parentId ?? null };
  },
});
