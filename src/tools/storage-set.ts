import { tool } from 'ai';
import { z } from 'zod';

const STATE_PREFIX = 'state:';

export const storageSet = tool({
  description:
    'Save a named blob of state for future invocations. Value must be JSON-serialisable. Use storage_get to read it back.',
  inputSchema: z.object({
    key: z.string().min(1),
    value: z.any(),
  }),
  execute: async ({ key, value }) => {
    const full = STATE_PREFIX + key;
    await chrome.storage.local.set({ [full]: value });
    return { ok: true };
  },
});
