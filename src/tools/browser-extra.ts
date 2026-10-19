import { tool } from 'ai';
import { z } from 'zod';

/**
 * sessions: get recently closed tabs and windows.
 */
export const sessionsRecent = tool({
  description: 'Get recently closed tabs and windows.',
  inputSchema: z.object({
    maxResults: z.number().int().min(1).max(25).optional().describe('Max sessions to return (default 10).'),
  }),
  execute: async ({ maxResults }) => {
    try {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: maxResults ?? 10 });
      return {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          lastModified: s.lastModified,
          tab: s.tab ? { id: s.tab.sessionId, title: s.tab.title, url: s.tab.url } : null,
          window: s.window ? { id: s.window.sessionId, tabCount: s.window.tabs?.length } : null,
        })),
      };
    } catch (e) {
      return { error: `Failed to query sessions: ${(e as Error).message}` };
    }
  },
});

/**
 * sessions: restore a recently closed tab or window.
 */
export const sessionsRestore = tool({
  description: 'Restore a recently closed tab or window by its sessionId.',
  inputSchema: z.object({
    sessionId: z.string().optional().describe('Session ID to restore. If omitted, restores the most recently closed.'),
  }),
  execute: async ({ sessionId }) => {
    try {
      const restored = await chrome.sessions.restore(sessionId);
      return {
        ok: true,
        restored: {
          tabId: restored.tab?.id,
          title: restored.tab?.title,
          url: restored.tab?.url,
        },
      };
    } catch (e) {
      return { error: `Failed to restore session: ${(e as Error).message}` };
    }
  },
});

/**
 * topSites: get user's most visited sites.
 */
export const topSitesGet = tool({
  description: 'Get the top sites most frequently visited by the user.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const sites = await chrome.topSites.get();
      return { sites: sites.slice(0, 20) };
    } catch (e) {
      return { error: `Failed to get top sites: ${(e as Error).message}` };
    }
  },
});

/**
 * cookies: get cookies for a domain or url.
 */
export const cookiesGet = tool({
  description: 'Get cookies matching a domain or URL.',
  inputSchema: z.object({
    url: z.string().optional().describe('URL to match cookies for.'),
    domain: z.string().optional().describe('Domain to match cookies for.'),
    name: z.string().optional().describe('Cookie name to match.'),
  }),
  execute: async ({ url, domain, name }) => {
    try {
      const details: chrome.cookies.GetAllDetails = {};
      if (url) details.url = url;
      if (domain) details.domain = domain;
      if (name) details.name = name;

      const all = await chrome.cookies.getAll(details);
      return {
        count: all.length,
        cookies: all.slice(0, 50).map((c) => ({
          name: c.name,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          valueLength: c.value?.length ?? 0,
          valuePreview: c.value ? `${c.value.slice(0, 8)}...` : '',
        })),
      };
    } catch (e) {
      return { error: `Failed to get cookies: ${(e as Error).message}` };
    }
  },
});

/**
 * cookies: set a cookie.
 */
export const cookiesSet = tool({
  description: 'Set a cookie for a URL.',
  inputSchema: z.object({
    url: z.string().describe('URL to associate with the cookie.'),
    name: z.string().describe('Cookie name.'),
    value: z.string().describe('Cookie value.'),
    domain: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    expirationDate: z.number().optional(),
  }),
  execute: async ({ url, name, value, domain, path, secure, httpOnly, expirationDate }) => {
    try {
      const res = await chrome.cookies.set({
        url,
        name,
        value,
        domain,
        path,
        secure,
        httpOnly,
        expirationDate,
      });
      return { ok: !!res, name: res?.name, domain: res?.domain };
    } catch (e) {
      return { error: `Failed to set cookie: ${(e as Error).message}` };
    }
  },
});

/**
 * cookies: remove a cookie.
 */
export const cookiesRemove = tool({
  description: 'Remove a cookie by URL and name.',
  inputSchema: z.object({
    url: z.string().describe('URL associated with the cookie.'),
    name: z.string().describe('Cookie name to remove.'),
  }),
  execute: async ({ url, name }) => {
    try {
      const details = await chrome.cookies.remove({ url, name });
      return { ok: !!details, url: details?.url, name: details?.name };
    } catch (e) {
      return { error: `Failed to remove cookie: ${(e as Error).message}` };
    }
  },
});

/**
 * browsingData: remove browsing data.
 */
export const browsingDataRemove = tool({
  description: 'Remove browsing data (cache, cookies, downloads, history) since a timestamp.',
  inputSchema: z.object({
    sinceMs: z.number().optional().describe('Clear data since timestamp in ms (default 0 = everything).'),
    cache: z.boolean().optional(),
    cookies: z.boolean().optional(),
    downloads: z.boolean().optional(),
    history: z.boolean().optional(),
  }),
  execute: async ({ sinceMs, cache, cookies, downloads, history }) => {
    try {
      const options: chrome.browsingData.RemovalOptions = {
        since: sinceMs ?? 0,
      };
      const dataToRemove: chrome.browsingData.DataTypeSet = {
        cache: cache ?? false,
        cookies: cookies ?? false,
        downloads: downloads ?? false,
        history: history ?? false,
      };
      await chrome.browsingData.remove(options, dataToRemove);
      return { ok: true, removed: dataToRemove };
    } catch (e) {
      return { error: `Failed to remove browsing data: ${(e as Error).message}` };
    }
  },
});

/**
 * pageCapture: save tab as MHTML archive.
 */
export const pageCaptureMhtml = tool({
  description: 'Capture a page as an MHTML archive blob.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID to capture (defaults to active tab).'),
  }),
  execute: async ({ tabId }) => {
    try {
      let targetId = tabId;
      if (!targetId) {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetId = active?.id;
      }
      if (!targetId) return { error: 'No active tab found' };

      const blob = await chrome.pageCapture.saveAsMHTML({ tabId: targetId });
      return {
        ok: true,
        tabId: targetId,
        sizeBytes: blob?.size ?? 0,
        type: blob?.type,
      };
    } catch (e) {
      return { error: `Failed to capture MHTML: ${(e as Error).message}` };
    }
  },
});

/**
 * search: query the default browser search provider.
 */
export const browserSearch = tool({
  description: 'Perform a search using the user default search engine in a new or current tab.',
  inputSchema: z.object({
    text: z.string().describe('Search query string.'),
    disposition: z.enum(['CURRENT_TAB', 'NEW_TAB', 'NEW_WINDOW']).optional().describe('Where to open results (default NEW_TAB).'),
  }),
  execute: async ({ text, disposition }) => {
    try {
      await chrome.search.query({
        text,
        disposition: (disposition as chrome.search.Disposition) || 'NEW_TAB',
      });
      return { ok: true, query: text };
    } catch (e) {
      return { error: `Failed to execute search: ${(e as Error).message}` };
    }
  },
});

/**
 * tts: text-to-speech speak.
 */
export const ttsSpeak = tool({
  description: 'Speak text aloud using Chrome text-to-speech engine.',
  inputSchema: z.object({
    text: z.string().describe('Text to speak.'),
    rate: z.number().min(0.1).max(10).optional().describe('Speaking rate (default 1.0).'),
    pitch: z.number().min(0).max(2).optional().describe('Speaking pitch (default 1.0).'),
  }),
  execute: async ({ text, rate, pitch }) => {
    try {
      chrome.tts.speak(text, {
        rate: rate ?? 1.0,
        pitch: pitch ?? 1.0,
      });
      return { ok: true, spokenChars: text.length };
    } catch (e) {
      return { error: `Failed to speak: ${(e as Error).message}` };
    }
  },
});

/**
 * tts: stop text-to-speech.
 */
export const ttsStop = tool({
  description: 'Stop any currently playing text-to-speech audio.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      chrome.tts.stop();
      return { ok: true };
    } catch (e) {
      return { error: `Failed to stop tts: ${(e as Error).message}` };
    }
  },
});

/**
 * power: manage keep awake state.
 */
export const powerKeepAwake = tool({
  description: 'Request Chrome keep the display or system awake, or release keep awake.',
  inputSchema: z.object({
    level: z.enum(['display', 'system', 'release']).describe("Keep awake level: 'display', 'system', or 'release' to release."),
  }),
  execute: async ({ level }) => {
    try {
      if (level === 'release') {
        chrome.power.releaseKeepAwake();
        return { ok: true, state: 'released' };
      }
      chrome.power.requestKeepAwake(level);
      return { ok: true, state: level };
    } catch (e) {
      return { error: `Failed to set power state: ${(e as Error).message}` };
    }
  },
});

/**
 * management: list installed extensions and apps.
 */
export const extensionsList = tool({
  description: 'List installed extensions and apps with their ID, name, enabled status, and permissions.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const items = await chrome.management.getAll();
      return {
        count: items.length,
        extensions: items.map((ext) => ({
          id: ext.id,
          name: ext.name,
          enabled: ext.enabled,
          type: ext.type,
          version: ext.version,
          permissions: ext.permissions?.slice(0, 10),
        })),
      };
    } catch (e) {
      return { error: `Failed to list extensions: ${(e as Error).message}` };
    }
  },
});

/**
 * webNavigation: get frames for a tab.
 */
export const webNavigationFrames = tool({
  description: 'Get all frames for a tab using chrome.webNavigation.',
  inputSchema: z.object({
    tabId: z.number().describe('Tab ID to get frames for.'),
  }),
  execute: async ({ tabId }) => {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      return {
        tabId,
        frames: (frames || []).map((f) => ({
          frameId: f.frameId,
          parentFrameId: f.parentFrameId,
          url: f.url,
          errorOccurred: f.errorOccurred,
        })),
      };
    } catch (e) {
      return { error: `Failed to get frames: ${(e as Error).message}` };
    }
  },
});

/**
 * system.cpu: get CPU info.
 */
export const systemCpuInfo = tool({
  description: 'Get CPU architecture, model name, and processor usage.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const info = await chrome.system.cpu.getInfo();
      return {
        modelName: info.modelName,
        archName: info.archName,
        numOfProcessors: info.numOfProcessors,
        processors: info.processors.map((p) => ({ usage: p.usage })),
      };
    } catch (e) {
      return { error: `Failed to get CPU info: ${(e as Error).message}` };
    }
  },
});

/**
 * system.memory: get memory info.
 */
export const systemMemoryInfo = tool({
  description: 'Get physical memory capacity and available capacity in bytes.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const info = await chrome.system.memory.getInfo();
      return {
        capacityBytes: info.capacity,
        availableCapacityBytes: info.availableCapacity,
      };
    } catch (e) {
      return { error: `Failed to get memory info: ${(e as Error).message}` };
    }
  },
});

/**
 * system.storage: get storage devices info.
 */
export const systemStorageInfo = tool({
  description: 'Get information about attached storage devices.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const devices = await chrome.system.storage.getInfo();
      return {
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          capacity: d.capacity,
        })),
      };
    } catch (e) {
      return { error: `Failed to get storage info: ${(e as Error).message}` };
    }
  },
});

/**
 * system.display: get display monitors info.
 */
export const systemDisplayInfo = tool({
  description: 'Get information about connected displays and monitors.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const displays = await chrome.system.display.getInfo({});
      return {
        displays: displays.map((d) => ({
          id: d.id,
          name: d.name,
          isPrimary: d.isPrimary,
          bounds: d.bounds,
          workArea: d.workArea,
        })),
      };
    } catch (e) {
      return { error: `Failed to get display info: ${(e as Error).message}` };
    }
  },
});
