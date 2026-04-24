import { tool } from 'ai';
import { z } from 'zod';

export const downloadList = tool({
  description:
    "Search the user's downloads. Returns up to 100 matching items ordered most-recent first. All filters are optional.",
  inputSchema: z.object({
    query: z.array(z.string()).optional().describe('Keywords matched against filename and URL'),
    state: z.enum(['in_progress', 'interrupted', 'complete']).optional(),
    startedAfter: z.string().optional().describe('ISO date string'),
    startedBefore: z.string().optional().describe('ISO date string'),
    limit: z.number().int().positive().max(100).optional(),
  }),
  execute: async ({ query, state, startedAfter, startedBefore, limit }) => {
    const results = await chrome.downloads.search({
      query,
      state,
      startedAfter,
      startedBefore,
      limit: limit ?? 50,
      orderBy: ['-startTime'],
    });
    return results.map((d) => ({
      downloadId: d.id,
      filename: d.filename,
      url: d.url,
      finalUrl: d.finalUrl,
      state: d.state,
      bytesReceived: d.bytesReceived,
      totalBytes: d.totalBytes,
      mime: d.mime,
      startTime: d.startTime,
      endTime: d.endTime,
      paused: d.paused,
      error: d.error ?? null,
    }));
  },
});
