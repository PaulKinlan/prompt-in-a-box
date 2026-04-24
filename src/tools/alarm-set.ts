import { tool } from 'ai';
import { z } from 'zod';

export const alarmSet = tool({
  description:
    'Create or replace a named Chrome alarm. The extension wakes on alarm fire, but the prompt itself is not notified per-alarm — use this only for scheduling extension-level side effects.',
  inputSchema: z.object({
    name: z.string().min(1),
    delayMinutes: z.number().positive().optional(),
    periodMinutes: z.number().positive().optional(),
  }),
  execute: async ({ name, delayMinutes, periodMinutes }) => {
    await chrome.alarms.create(name, {
      delayInMinutes: delayMinutes,
      periodInMinutes: periodMinutes,
    });
    return { ok: true };
  },
});
