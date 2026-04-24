# Prompt in a Box

A Chrome extension whose entire behaviour lives in a markdown file. First-time users get an onboarding flow that picks a provider and validates an API key; returning users get a full options page with a per-run audit log (tool calls, token counts, cost per run, exportable JSON).

A `.crx` is a zip plus a manifest. It already has a permission model, a sandbox, a distribution channel, and an event-driven runtime that wakes on schedule. Drop a prompt into that zip alongside a generic agent loop, and you have a distributable prompt-program. The manifest declares what the agent can reach. The prompt declares what the agent should do. Swap `prompt.md` for a different set of instructions and the same extension becomes a different tool.

This repo is a working minimum of that pattern. It uses [agent-do](https://www.npmjs.com/package/agent-do) as the loop, exposes Chrome APIs as tools (one file per tool), keeps state in OPFS and `chrome.storage.local`, and ships with one example prompt (a tab-hygiene agent) so you can see the end-to-end shape.

## Layout

```
manifest.json           – permissions, host_permissions, CSP, alarm defaults
prompt.md               – the program. swap this for a different behaviour.
icon.png                – placeholder icon
src/
  background.ts         – MV3 service worker: alarm wiring, popup/options RPC, loop driver, audit capture
  popup.ts / popup.html – quick-glance runner: current provider, "Run now", link to options
  options.ts /          – full settings + audit view (onboarding flow too)
  options.html
  config.ts             – provider selection, per-provider API keys, schedule
  audit.ts              – per-run audit records: tool calls, tokens, cost, OPFS-backed
  storage/
    opfs.ts             – Origin Private File System wrapper
  tools/
    index.ts            – permission → tools mapping
    tab-*.ts            – list/open/close/focus/navigate/duplicate/move/mute/pin/group
    tab-read.ts         – scrape visible tab text (via chrome.scripting)
    tab-screenshot.ts   – capture visible area to OPFS
    window-*.ts         – list/create/close/focus/resize
    bookmark-*.ts       – search/add/list/remove
    history-search.ts
    download-*.ts       – file/list
    alarm-*.ts          – set/list/clear
    context-menu-*.ts   – create/update/remove/list
    reading-list-*.ts   – add/query
    clipboard-write.ts  – via offscreen document
    notification-show.ts
    storage-get.ts / storage-set.ts
    opfs-read.ts / opfs-write.ts / opfs-list.ts
  events/
    registry.ts         – Chrome event source catalogue (immediate + queued)
    dispatcher.ts       – subscribes to events based on granted permissions
    queue.ts            – OPFS-backed JSONL queue for ambient events
  offscreen.ts /        – DOM-dependent operations (clipboard, HTML parsing)
  offscreen.html
  offscreen-client.ts   – SW-side RPC to the offscreen document
  stubs/
    mcp-sdk.ts          – build-time stubs (agent-do's MCP imports are node-only)
    node-only.ts
    node-module.ts
build.js                – esbuild driver → dist/background.js, dist/popup.js, dist/options.js, dist/offscreen.js
dist/                   – bundled output (gitignored)
```

Nothing in `background.ts`, `config.ts`, `popup.ts`, or the tool files is specific to tab hygiene. Replace `prompt.md` with different instructions and the same infrastructure runs a different agent.

## Install (unpacked)

1. Clone this repo and build it:
   ```sh
   npm install
   npm run build
   ```
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this directory.

To produce a distributable zip instead:

```sh
npm run release   # build + pack in one step
```

Produces `prompt-in-a-box.zip` containing only what Chrome needs at runtime (`manifest.json`, `prompt.md`, `icon.png`, `dist/*.{js,html}`). The `examples/` folder and all source files are excluded.
3. The options page opens automatically on first install. Pick a provider (Anthropic, Google, or OpenAI), paste the API key, click **Test** to verify, then **Save**.
4. Click the toolbar icon → **Run now**.
5. If you have more than 20 tabs open, you should see a desktop notification within a few seconds.

The extension then runs on a 30-minute alarm (configurable in the options page).

### Provider selection

Three providers are wired in: Anthropic (Claude), Google (Gemini), and OpenAI (GPT). API keys are stored *per provider* so switching back and forth doesn't lose any of them. Only the currently-selected provider's key is used at run time; only that provider's endpoint is contacted.

### Audit log

Every run captures:
- Trigger (alarm, manual, onboarding test) and duration
- Provider and model used
- Full tool-call trace — name, arguments, result, timestamp, duration per call
- Token usage (input / output) and estimated cost
- Final text the model returned

Detailed records live in OPFS (`audit/<runId>.json`); a summary index lives in `chrome.storage.local` for fast pagination. The options page shows a stats header (total runs, successful runs, total tool calls, total estimated spend) and expandable rows for each run. **Export JSON** downloads the complete log of every detailed record as a single file.

## Why MV3 service workers are a surprisingly good agent runtime

- **Event-driven.** `chrome.alarms` wakes the service worker on schedule. When the loop finishes, Chrome terminates the SW. No daemon, no heartbeat, no wasted memory between runs.
- **Sandboxed.** No DOM access from the SW. No `eval`, no inline scripts, no dynamic code evaluation under the extension's CSP. No network beyond what `host_permissions` allows.
- **Persistent state without a server.** `chrome.storage.local` + OPFS together cover most small-agent state. OPFS gives you a real filesystem (read, write, list, nested directories) scoped to the extension's origin.
- **Declarative capabilities.** The manifest enumerates which APIs the extension (and therefore the prompt) can touch. A tool backed by an ungranted permission is simply not in the agent's toolset; the model can't call what it can't see.

The post that introduces this demo — [where prompts run](https://aifoc.us/where-prompts-run) — argues the host is now the interesting part of an agent system. The CRX is one such host, and it happens to already have almost everything you need.

## How the loop works

The service worker runs the agent loop in response to seven distinct triggers, each recorded in the audit log:

| Trigger | Fires when | User message to the prompt |
| --- | --- | --- |
| `install` | Extension freshly installed | "The extension was just installed. Perform any bootstrap steps…" + queued events (if any) |
| `update` | Extension updated to a new version | "The extension was just updated. Re-assert state new prompt logic needs…" + queued events |
| `startup` | Browser starts | "The browser just started. Re-check state; drain queued events below." |
| `alarm` | Scheduled tick (`chrome.alarms`, every `cfg.alarmMinutes`) | "Begin your scheduled run now." or the queued events |
| `event` | An immediate-trigger event fires (context menu click, notification click, keyboard command, omnibox entry) | "Chrome events have fired since your last run. …" + the event payload |
| `manual` | User clicks **Run now** in the popup | Same as `alarm` |
| `onboarding-test` | User clicks **Test** in the options page during setup | Same as `alarm`, but with a temporary config patch |

On every trigger the SW:

1. Loads `prompt.md` via `chrome.runtime.getURL` + `fetch`.
2. Builds a `ToolSet` of only the Chrome APIs granted by the manifest (see `src/tools/index.ts` — each permission unlocks a bucket).
3. Calls [`agent-do`'s `runAgentLoop`](https://www.npmjs.com/package/agent-do) with the configured model, `prompt.md` as the system message, and the tool set.
4. `agent-do` runs the tool-use loop until the model returns a final message with no tool calls (or `maxIterations` is reached).
5. Writes a full audit record (tool calls, tokens, cost, final text) to OPFS + a summary index to `chrome.storage.local`.
6. The SW exits. Chrome kills it shortly after.

### Bootstrap on install/update/startup

Install, update, and startup triggers give the prompt a first-run hook. Use this for idempotent setup:

- Create context menu items (check `context_menu_list` first so re-runs are no-ops).
- Seed default values in `storage_set` if missing.
- Write OPFS directory markers or initial log files.
- Re-assert keyboard command defaults.

Context menus, keyboard shortcuts, and omnibox keywords **survive** SW restarts — Chrome holds them. You still want an idempotent bootstrap run to cover the fresh-install case and to re-seed anything your prompt needs.

`agent-do` handles the provider abstraction, tool-call marshalling, permissions, and usage tracking. This project contributes the host wiring: which Chrome APIs are tools, how state persists, when the loop fires. That separation is the point.

## Events: the agent reacts to the browser

Scheduled ticks aren't the only reason the agent wakes. `src/events/` subscribes to every Chrome event source the manifest has permission for and either:

- **Triggers a run immediately** — context-menu clicks, notification clicks, keyboard shortcuts, omnibox entries. The user just did something and expects a response.
- **Queues the event for the next run** — tab created/updated/removed, bookmark added/changed, history visited, download started/finished, window focus change, reading-list changes, tab-group changes, webNavigation completion, idle state changes.

When a run starts, `composeUserMessage` drains the queue and hands the events to the prompt as "Events since last run". The prompt decides what, if anything, to act on. This lets a single prompt create a context menu item *and* handle its clicks, or watch for new bookmarks and react on the next tick.

If the prompt doesn't need a given event, the operator doesn't grant the permission; the subscription is skipped. Permission declarations remain the one knob.

## Offscreen document

Some operations need a DOM — most famously clipboard writes (`navigator.clipboard.writeText`) and HTML parsing (`DOMParser`). Service workers have neither. `src/offscreen.ts` runs in an offscreen document created on demand; the SW talks to it via `chrome.runtime.sendMessage`. This is how `clipboard_write` works. The same document can be extended with more DOM-dependent tools.

## Artifacts — things the agent creates for you

A prompt produces two kinds of output: **internal state** (cursors, dedup keys, event logs — written via `opfs_write` / `storage_set`) and **artifacts** (user-facing things the human will want to browse — summaries, digests, journal entries, screenshots, quotes, meeting notes). Artifacts are written via the `artifact_create` tool and appear in:

- The extension popup's "Recent artifacts" list (latest 5, click to open).
- The full artifacts browser at `dist/artifacts.html` — group by date, filter by kind/tag/source, inline viewer with a minimal markdown renderer, per-artifact download and delete.

Under the hood, `artifact_create` writes content to OPFS under `artifacts/YYYY-MM-DD/<slug>-<id>.<ext>` and appends a metadata row (title, kind, tags, preview, source URL, size) to an index in `chrome.storage.local`. The popup and browser read the index directly; the content is loaded on demand.

Supported kinds: `markdown`, `html`, `json`, `text`, `image-png`, `image-jpeg`. Images come in as base64 without the `data:` prefix.

A prompt doesn't have to produce artifacts. A tab-hygiene prompt might never create one. A summarising prompt might create one per day. The choice belongs to the prompt.

## Swapping in a different prompt

Replace `prompt.md`. That's it. Everything else stays the same.

If a new prompt wants additional capabilities (history, scripting, downloads, clipboard), add the corresponding permission in `manifest.json`'s `optional_permissions` and add a matching tool file in `src/tools/`. The permission boundary is the contract.

## Examples

`examples/` has 27 demo prompts, each in its own folder with a `prompt.md` and a short `README.md` listing the permissions it needs and what it does. They cover the surface — right-click summarisers, tab hygiene variants, focus mode, auto-reading-list, omnibox answers, meeting-prep templates, hourly tab-screenshot diaries, bookmark cleaners, and more.

Try one by copying its `prompt.md` over the root `prompt.md` (and granting the permissions its README lists), then `npm run build`. See [`examples/README.md`](examples/README.md) for full instructions.

Examples are **not** shipped in the zip — `npm run pack` only includes the root `prompt.md`.

## Security notes

- API keys live only in `chrome.storage.local`. They never leave the browser except as outbound calls to endpoints declared in `host_permissions`.
- The extension's CSP (`extension_pages`) restricts `script-src` and `connect-src`, so even a compromised popup can't exfiltrate to an arbitrary origin.
- `prompt.md` is in `web_accessible_resources` so the SW can `fetch` it via `chrome.runtime.getURL`. It's only accessible from the extension origin.
- Every tool the model can call is gated by a Chrome permission at the browser boundary. Removing a permission removes the capability without a code change.
- agent-do's MCP server mounting is stubbed out in this build (MCP transports need `node:child_process`, which doesn't exist in a service worker). Leave `mcpServers` unset in the loop config.

## What's still to do

This is a proof-of-concept, not a product:

- Tools aren't auto-generated from the manifest's `permissions` array — adding a permission still requires writing its tool file.
- No tests yet.
- A few low-value Chrome event sources (`cookies.onChanged`, `permissions.onAdded`, etc.) aren't wired.

## License

MIT.
