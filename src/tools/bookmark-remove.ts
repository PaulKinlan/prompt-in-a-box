import { tool } from 'ai';
import { z } from 'zod';

export const bookmarkRemove = tool({
  description:
    'Delete a bookmark or folder by id. Set recursive=true to delete non-empty folders.',
  inputSchema: z.object({
    id: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  execute: async ({ id, recursive }) => {
    if (recursive) {
      await chrome.bookmarks.removeTree(id);
    } else {
      await chrome.bookmarks.remove(id);
    }
    return { ok: true };
  },
});
