import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

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
    let hadPrevious = false;
    let previousValue: unknown;

    try {
      const existing = await chrome.storage.local.get(full);
      if (full in existing) {
        hadPrevious = true;
        previousValue = existing[full];
      }
    } catch {
      // Ignore
    }

    await chrome.storage.local.set({ [full]: value });

    await recordAction({
      toolName: 'storage_set',
      label: `Updated state: "${key}"`,
      detail: typeof value === 'object' ? JSON.stringify(value).slice(0, 50) : String(value),
      undo: {
        kind: 'storage_set',
        fullKey: full,
        hadPrevious,
        previousValue,
      },
    });

    return { ok: true };
  },
});
