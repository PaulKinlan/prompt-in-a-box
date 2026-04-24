import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs';

export const opfsWrite = tool({
  description:
    'Write a text file in the extension\'s sandboxed file system (OPFS). Creates intermediate directories as needed. Overwrites if the file exists.',
  inputSchema: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  execute: async ({ path, content }) => {
    try {
      await opfs.writeText(path, content);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
