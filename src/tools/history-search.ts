import { tool } from 'ai';
import { z } from 'zod';

export const historySearch = tool({
  description:
    'Search the user\'s browsing history. Optional date bounds in ms-since-epoch. Returns up to 100 results.',
  inputSchema: z.object({
    text: z.string().describe('Free-text query (matches URL and title)'),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
    maxResults: z.number().int().positive().max(100).optional().describe('Default 50'),
  }),
  execute: async ({ text, startTime, endTime, maxResults }) => {
    const items = await chrome.history.search({
      text,
      startTime,
      endTime,
      maxResults: maxResults ?? 50,
    });
    return items.map((h) => ({
      url: h.url,
      title: h.title ?? '',
      lastVisitTime: h.lastVisitTime ?? null,
      visitCount: h.visitCount ?? 0,
    }));
  },
});
