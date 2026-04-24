import { tool } from 'ai';
import { z } from 'zod';

interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime?: number;
  lastUpdateTime?: number;
}
interface ReadingListApi {
  query(filter: { hasBeenRead?: boolean; url?: string }): Promise<ReadingListEntry[]>;
}
function api(): ReadingListApi {
  return (chrome as unknown as { readingList: ReadingListApi }).readingList;
}

export const readingListQuery = tool({
  description:
    "Query the user's reading list. All filters are optional; omit them all to list everything.",
  inputSchema: z.object({
    hasBeenRead: z.boolean().optional(),
    url: z.string().url().optional(),
  }),
  execute: async ({ hasBeenRead, url }) => {
    const entries = await api().query({ hasBeenRead, url });
    return entries.map((e: ReadingListEntry) => ({
      url: e.url,
      title: e.title,
      hasBeenRead: e.hasBeenRead,
      creationTime: e.creationTime,
      lastUpdateTime: e.lastUpdateTime,
    }));
  },
});
