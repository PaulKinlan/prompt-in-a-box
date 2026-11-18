import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { writeStateValue } from '../storage/state-keys';

export const storageSet = tool({
  description:
    'Save a named blob of state for future invocations. Value must be JSON-serialisable. Use storage_get to read it back.',
  inputSchema: z.object({
    key: z.string().min(1),
    value: z.any(),
  }),
  execute: async ({ key, value }) => {
    const { fullKey, shortKey, hadPrevious, previousValue } = await writeStateValue(key, value);

    await recordAction({
      toolName: 'storage_set',
      label: `Updated state: "${shortKey}"`,
      detail: typeof value === 'object' ? JSON.stringify(value).slice(0, 50) : String(value),
      undo: {
        kind: 'storage_set',
        fullKey,
        hadPrevious,
        previousValue,
      },
    });

    return { ok: true };
  },
});
