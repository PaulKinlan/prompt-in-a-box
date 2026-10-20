import { tool } from 'ai';
import { z } from 'zod';
import { getConfig } from '../config';

export const alarmSet = tool({
  description:
    'Create or replace a named Chrome alarm. When the alarm fires, the extension wakes and invokes the agent with the alarm name in context. Note: Alarms cannot run more frequently than the user-configured schedule interval.',
  inputSchema: z.object({
    name: z.string().min(1),
    delayMinutes: z.number().positive().optional(),
    periodMinutes: z.number().positive().optional(),
  }),
  execute: async ({ name, delayMinutes, periodMinutes }) => {
    if (name === 'prompt-in-a-box-tick') {
      return { ok: false, error: "Cannot modify or overwrite system schedule alarm 'prompt-in-a-box-tick'." };
    }
    const cfg = await getConfig();
    if (cfg.alarmMinutes <= 0) {
      return { ok: false, error: 'Background alarms are disabled because the extension schedule is set to Never.' };
    }

    const minFloor = Math.max(1, cfg.alarmMinutes);
    const effectivePeriod = periodMinutes !== undefined ? Math.max(minFloor, periodMinutes) : undefined;
    const effectiveDelay = delayMinutes !== undefined ? Math.max(minFloor, delayMinutes) : (effectivePeriod ?? minFloor);

    const alarmInfo =
      effectiveDelay !== undefined && effectivePeriod !== undefined
        ? { delayInMinutes: effectiveDelay, periodInMinutes: effectivePeriod }
        : effectiveDelay !== undefined
          ? { delayInMinutes: effectiveDelay }
          : { periodInMinutes: effectivePeriod ?? minFloor };

    await chrome.alarms.create(name, alarmInfo);
    return { ok: true, delayMinutes: effectiveDelay, periodMinutes: effectivePeriod };
  },
});
