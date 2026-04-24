/**
 * Tool bindings: Chrome APIs exposed as model-callable tools.
 *
 * Each tool has a JSON-schema describing its inputs, a short
 * description for the model, and an async execute function. The set
 * returned here is generic — it matches what the example prompt.md
 * needs (tabs, notifications, state), but a different prompt could
 * need different tools (history, bookmarks, scripting, downloads,
 * etc.). That's the next generalisation step: let the manifest
 * declare which tools are exposed, mirroring its permissions block.
 *
 * Anything a tool does is bounded by the `permissions` and
 * `host_permissions` Chrome grants the extension. If the manifest
 * doesn't ask for `tabs`, chrome.tabs.query returns an error, and
 * the model sees that error in its tool-result. The sandbox is
 * provided by the browser; this file just names what's available.
 */

const STATE_KEY_PREFIX = 'state:';

export function buildTools() {
  return [
    {
      name: 'list_tabs',
      description:
        'List the user\'s open tabs across all windows. Returns id, title, url, pinned, windowId, incognito, lastAccessed (ms since epoch or null).',
      input_schema: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          pinned: t.pinned,
          windowId: t.windowId,
          incognito: t.incognito,
          lastAccessed: t.lastAccessed ?? null,
        }));
      },
    },
    {
      name: 'notify',
      description:
        'Send a single desktop notification to the user. Takes a short title (max ~60 chars) and a body (max ~300 chars).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 80 },
          body: { type: 'string', maxLength: 400 },
        },
        required: ['title', 'body'],
      },
      execute: async ({ title, body }) => {
        const id = `pib-${Date.now()}`;
        await chrome.notifications.create(id, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon.png'),
          title: String(title).slice(0, 80),
          message: String(body).slice(0, 400),
        });
        return { ok: true, id };
      },
    },
    {
      name: 'get_state',
      description:
        'Read a named blob of state the agent previously saved. Returns the stored JSON or null if unset.',
      input_schema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
      execute: async ({ key }) => {
        const full = STATE_KEY_PREFIX + String(key);
        const got = await chrome.storage.local.get(full);
        return got[full] ?? null;
      },
    },
    {
      name: 'set_state',
      description:
        'Save a named blob of state for the next invocation. Value must be JSON-serialisable.',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
        },
        required: ['key', 'value'],
      },
      execute: async ({ key, value }) => {
        const full = STATE_KEY_PREFIX + String(key);
        await chrome.storage.local.set({ [full]: value });
        return { ok: true };
      },
    },
  ];
}
