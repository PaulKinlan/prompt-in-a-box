import { tool } from 'ai';
import { z } from 'zod';

export const notificationShow = tool({
  description:
    'Send a single desktop notification to the user. Keep titles short (<= 80 chars) and bodies concise (<= 400 chars).',
  inputSchema: z.object({
    title: z.string().max(80),
    body: z.string().max(400),
  }),
  execute: async ({ title, body }) => {
    const id = `pib-${Date.now()}`;
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: title.slice(0, 80),
      message: body.slice(0, 400),
    });
    return { id };
  },
});
