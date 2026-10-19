import { tool } from 'ai';
import { z } from 'zod';

export const alarmSet = tool({
  description:
    'Create or replace a named Chrome alarm. When the alarm fires, the extension wakes and invokes the agent with the alarm name in context.',
  inputSchema: z.object({
    name: z.string().min(1),
    delayMinutes: z.number().positive().optional(),
    periodMinutes: z.number().positive().optional(),
  }),
  execute: async ({ name, delayMinutes, periodMinutes }) => {
    const alarmInfo =
      delayMinutes !== undefined && periodMinutes !== undefined
        ? { delayInMinutes: delayMinutes, periodInMinutes: periodMinutes }
        : delayMinutes !== undefined
          ? { delayInMinutes: delayMinutes }
          : { periodInMinutes: periodMinutes ?? 1 };
    await chrome.alarms.create(name, alarmInfo);
    return { ok: true };
  },
});
