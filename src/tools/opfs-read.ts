import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs';

export const opfsRead = tool({
  description:
    'Read a text file from the extension\'s sandboxed file system (OPFS). Paths are POSIX-style relative to the OPFS root.',
  inputSchema: z.object({ path: z.string().min(1) }),
  execute: async ({ path }) => {
    try {
      return { ok: true as const, content: await opfs.readText(path) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
