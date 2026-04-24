import { tool } from 'ai';
import { z } from 'zod';

export const bookmarkSearch = tool({
  description:
    'Search the user\'s bookmarks by keyword (matches title and URL). Returns up to 50 results.',
  inputSchema: z.object({
    query: z.string().min(1),
  }),
  execute: async ({ query }) => {
    const results = await chrome.bookmarks.search(query);
    return results.slice(0, 50).map((b) => ({ id: b.id, title: b.title, url: b.url ?? null }));
  },
});
