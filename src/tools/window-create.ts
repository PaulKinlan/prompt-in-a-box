import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { markAgentTabMutation, markAgentWindowMutation } from '../events/mutation-guard';

export const windowCreate = tool({
  description:
    'Open a new browser window. Optionally with one or more starting URLs, a specific type (normal/popup), position/size, focus state, and incognito mode.',
  inputSchema: z.object({
    urls: z.array(z.string().url()).optional(),
    type: z.enum(['normal', 'popup', 'panel']).optional(),
    focused: z.boolean().optional(),
    incognito: z.boolean().optional(),
    top: z.number().optional(),
    left: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    state: z.enum(['normal', 'minimized', 'maximized', 'fullscreen']).optional(),
  }),
  execute: async ({ urls, type, focused, incognito, top, left, width, height, state }) => {
    if (urls && urls.length > 0) {
      markAgentTabMutation([], { urls });
    }

    try {
      const created = await chrome.windows.create({
        url: urls,
        type,
        focused,
        incognito,
        top,
        left,
        width,
        height,
        state,
      });

      if (created?.id !== undefined) {
        markAgentWindowMutation(created.id);
      }

      const createdTabIds = (created?.tabs ?? [])
        .map((t) => t.id)
        .filter((id): id is number => id !== undefined);
      const createdTabUrls = [
        ...(urls ?? []),
        ...(created?.tabs ?? []).flatMap((t) => [t.url, t.pendingUrl]),
      ].filter((u): u is string => Boolean(u));

      if (createdTabIds.length > 0 || createdTabUrls.length > 0) {
        markAgentTabMutation(
          createdTabIds,
          createdTabUrls.length > 0 ? { urls: createdTabUrls } : undefined,
        );
      }

      if (created?.id !== undefined) {
        await recordAction({
          toolName: 'window_create',
          label: `Opened new window (${created.id})`,
          detail: urls ? `${urls.length} tabs: ${urls.slice(0, 2).join(', ')}` : 'New empty window',
          undo: {
            kind: 'window_create',
            createdWindowId: created.id,
          },
        });
      }

      return {
        ok: true,
        windowId: created?.id,
        tabIds: (created?.tabs ?? []).map((t) => t.id),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
