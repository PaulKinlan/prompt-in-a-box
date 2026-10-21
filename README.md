# Prompt in a Box

A Chrome extension whose entire behaviour lives in a markdown file. First-time users get an onboarding flow that picks a provider and validates an API key; returning users get a full options page with a per-run audit log (tool calls, token counts, cost per run, exportable JSON).

A `.crx` is a zip plus a manifest. It already has a permission model, a sandbox, a distribution channel, and an event-driven runtime that wakes on schedule. Drop a prompt into that zip alongside a generic agent loop, and you have a distributable prompt-program. The manifest declares what the agent can reach. The prompt declares what the agent should do. Swap `prompt.md` for a different set of instructions and the same extension becomes a different tool.

This repo is a working minimum of that pattern. It uses [agent-do](https://www.npmjs.com/package/agent-do) as the loop, exposes Chrome APIs as tools (one file per tool), keeps state in OPFS and `chrome.storage.local`, and ships with one example prompt (a tab-hygiene agent) so you can see the end-to-end shape.

## Layout

```
manifest.json           – permissions, host_permissions, CSP, alarm defaults
prompt.md               – the program. swap this for a different behaviour.
icon.png / icon-*.png   – extension icon (16/32/48/128); regenerate with `npm run icons`
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
scripts/
  create.js             – `npm run create`: scaffold a new example from a one-line idea (also generates its icon)
  gen-icons.js          – `npm run icons`: generate icons for the root + every example
  lib/icons.js          – icon engine: AI image generation with a procedural glyph fallback
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

Produces `prompt-in-a-box.zip` containing only what Chrome needs at runtime. The `examples/` folder and all source files are excluded.

### Working with Examples as Standalone Extensions

You can build and package any example directly inside its own folder under `examples/` without modifying your active workspace root. Each example becomes a fully functioning, self-contained, unpacked extension!

* **Build a specific example**:
  ```sh
  npm run build <example-slug>
  ```
  *(Example: `npm run build focus-mode`)*
  This compiles and builds all required extension files directly into `examples/<example-slug>/dist/`. If the example folder does not have an `icon.png` or `manifest.json`, the build tool automatically copies/generates them (customizing the manifest name/description to match the example). You can load the directory `examples/<example-slug>/` *directly* in Chrome under **Developer mode (Load unpacked)**!

* **Build and package an example directly**:
  ```sh
  npm run pack <example-slug>
  ```
  *(Example: `npm run pack focus-mode`)*
  This automatically compiles the example and packages it into a standalone ZIP file located *inside* the example directory: `examples/<example-slug>/<example-slug>.zip`!

### Icons

Every extension gets an icon that reflects what it does, at the four sizes Chrome wants (`icon-16/32/48/128.png`, plus a `icon.png` for backward compatibility).

```sh
npm run icons                      # root + every example (skips ones that already have icons)
npm run icons -- --force           # regenerate everything
npm run icons -- --only=focus-mode # just one example
npm run icons -- --no-ai           # skip the image model, use the procedural glyphs
```

There are two ways an icon gets made:

* **AI generation (preferred).** If `GEMINI_API_KEY` (or `OPENAI_API_KEY`) is set, an image model draws a bespoke icon from the extension's name and description. Override the model with `ICON_MODEL` or force a provider with `ICON_PROVIDER=google|openai|none`.
* **Procedural fallback.** With no key, a clean flat icon is composed from a per-extension gradient and a hand-drawn glyph matched to the extension's intent (a funnel for "organizer", a bookmark ribbon for bookmark tools, a camera for "screenshot", and so on). No network required.

`npm run create` generates an icon for the new example automatically as the final step.

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

## Provider-native tools

Custom tools (the ones under `src/tools/`) aren't the only thing the agent can call. Every provider ships server-executed tools we merge into the tool set:

| Provider | Tools |
| --- | --- |
| Anthropic | `web_search`, `web_fetch`, `code_execution` |
| Google (Gemini) | `google_search`, `url_context`, `code_execution` |
| OpenAI | `web_search` |

These execute on the provider's infrastructure and count against the same API usage as any other request. The results flow back to the agent loop as regular `tool-result` messages, same as local tools — the prompt doesn't need to know which is which.

On by default. Users can disable any of them by name from the options page. Disabling is by tool name, not by provider, so a single disable list applies consistently when switching providers (e.g. unchecking `code_execution` turns it off for both Anthropic and Google).

Implementation is in `src/provider-tools.ts`. The pattern mirrors what the CHAOS extension does — a factory function per provider that returns a `ToolSet`, merged into the custom set before the loop runs.

## Configuration & Policy Locking (`config.json`)

Extensions can declare static policies in `config.json` (or per-example `config.json`) to enforce locked enterprise, deployment, or evaluation configurations.

### Complete `config.json` Structure

```json
{
  "version": "1.0.0",
  "prompt": "prompt.md",
  "pack_hash": "...",
  "showAuditUI": true,
  "providers": {
    "allowed": ["google", "anthropic", "openai"],
    "default": "google",
    "lockProvider": false
  },
  "models": {
    "default": "gemini-3.8-flash",
    "lockModel": false,
    "allowCustomModelInput": true,
    "allowed": {
      "google": ["gemini-3.8-flash", "gemini-4-argon"],
      "anthropic": ["claude-sonnet-5-5", "claude-haiku-5-5"],
      "openai": ["gpt-6.1-sol", "gpt-5.6-sol"]
    }
  },
  "schedule": {
    "defaultAlarmMinutes": 30,
    "lockSchedule": false
  },
  "providerTools": {
    "disabledByDefault": [],
    "lockProviderTools": false
  },
  "permissions": {
    "allowed": ["tabs", "storage", "alarms"],
    "blocked": []
  },
  "agentSettings": {
    "storageKey": "my_extension_settings",
    "title": "Extension Preferences",
    "fields": [
      {
        "id": "enableFeatureX",
        "label": "Enable Feature X",
        "hint": "Turns on auxiliary scanning.",
        "type": "boolean",
        "default": false
      },
      {
        "id": "scanMode",
        "label": "Scan Mode",
        "hint": "Choose between quick and deep scanning.",
        "type": "select",
        "default": "quick",
        "options": [
          { "label": "Quick Scan", "value": "quick" },
          { "label": "Deep Scan", "value": "deep" }
        ]
      }
    ]
  },
  "ui": {
    "showAuditUI": true,
    "showCosts": true,
    "showTokenUsage": true,
    "showToolCallDetails": true,
    "showHistory": true,
    "showVersionBadge": true,
    "showPolicyBadge": true,
    "showStudio": false,
    "showPopupHeader": true,
    "showViewSwitcher": true,
    "showStatusCard": true,
    "showKeyStatusBadge": true,
    "showScheduleSummary": true,
    "showRecentArtifacts": true,
    "showPopupFooter": true,
    "allowSettingsAccess": true,
    "allowSidePanel": true,
    "showSidePanelHeader": true,
    "showSidePanelStatusBar": true,
    "showActivityDrawer": true,
    "showRecentRuns": true,
    "showOnboardingBanner": true,
    "showProviderSelector": true,
    "showApiKeyInput": true,
    "showModelSelector": true,
    "showProviderTools": true,
    "showPermissionsManager": true,
    "showSchedule": true,
    "allowTestConnection": true,
    "allowManualRun": true,
    "showAuditLog": true,
    "showAuditStats": true,
    "showAuditFilters": true,
    "allowExportAudit": true,
    "allowClearAudit": true,
    "allowArtifacts": true,
    "showArtifactStats": true,
    "showArtifactFilters": true,
    "allowCopyArtifact": true,
    "allowDownloadArtifact": true,
    "allowDeleteArtifacts": true
  },
  "features": {
    "showAuditUI": true,
    "showProviderSelector": true,
    "showModelSelector": true,
    "showProviderTools": true,
    "showPermissionsManager": true,
    "showSchedule": true,
    "showAuditLog": true,
    "allowExportAudit": true,
    "allowClearAudit": true,
    "allowSidePanel": true,
    "allowArtifacts": true,
    "allowManualRun": true
  }
}
```

---

### Configuration Reference Guide

#### 1. Top-Level Options
| Key | Type | Default | Description |
|---|---|---|---|
| `version` | `string` | `"1.0.0"` | Version of the extension package. Auto-bumped on build when contents change. |
| `prompt` | `string` | `"prompt.md"` | Relative path to the markdown file defining the agent's prompt and logic. |
| `pack_hash` | `string` | `""` | SHA-256 fingerprint of the extension package contents used for change detection. |
| `showAuditUI` | `boolean` | `true` | When set to `false`, hides the **Agent UI** tab (`#dynamicPopup` and the `[ Dashboard \| Agent UI ]` view switcher) from the popup, presenting users strictly with the standard **Dashboard** view (`#standardPopup`) to avoid distracting them. Can also be placed under `ui` or `features` (alias: `showAgentUI`). |

#### 2. Provider Settings (`providers`)
| Key | Type | Default | Description |
|---|---|---|---|
| `allowed` | `string[]` | `["anthropic", "google", "openai"]` | Whitelist of AI providers available to this extension. |
| `default` | `string` | `"google"` | Initial provider selected when the extension is installed. |
| `lockProvider` | `boolean` | `false` | When `true`, locks the provider to `default` and disables provider switching in the settings UI. |

#### 3. Model Settings (`models`)
| Key | Type | Default | Description |
|---|---|---|---|
| `default` | `string` | `"gemini-3.8-flash"` | Default model identifier used by the agent loop. |
| `lockModel` | `boolean` | `false` | When `true`, locks the active model and disables model selection in the settings UI. |
| `allowCustomModelInput` | `boolean` | `true` | When `false`, restricts users strictly to model choices enumerated in `allowed`. |
| `allowed` | `object` | *(Curated model lists)* | Maps each provider (`google`, `anthropic`, `openai`) to an array of allowable model ID strings. |

#### 4. Schedule Settings (`schedule`)
| Key | Type | Default | Description |
|---|---|---|---|
| `defaultAlarmMinutes` | `number` | `30` | Default periodic execution interval in minutes. Set to `0` for "Never" (manual run / event-triggered only). |
| `lockSchedule` | `boolean` | `false` | When `true`, locks the background alarm schedule and prevents users from changing it. |

#### 5. Provider Tools (`providerTools`)
| Key | Type | Default | Description |
|---|---|---|---|
| `disabledByDefault` | `string[]` | `[]` | Names of provider-native tools (`web_search`, `web_fetch`, `google_search`, `code_execution`, `url_context`) turned off by default. |
| `lockProviderTools` | `boolean` | `false` | When `true`, prevents users from modifying provider tool toggles in settings. |

#### 6. Permissions (`permissions`)
| Key | Type | Default | Description |
|---|---|---|---|
| `allowed` | `string[] \| undefined` | `undefined` | Optional whitelist of Chrome API permissions granted to the agent. |
| `blocked` | `string[]` | `[]` | Blacklist of Chrome API permissions explicitly forbidden from being requested or used. |

#### 7. User Agent Settings (`agentSettings`)
Declarative schema for runtime agent preferences. Settings render automatically as toggles or dropdowns in both the popup and side panel, and are injected into the agent prompt on every run:
| Key | Type | Description |
|---|---|---|
| `storageKey` | `string` | Storage key in `chrome.storage.local` where user-selected values are saved. |
| `title` | `string` | Header text displayed above the preferences card in the UI. |
| `fields` | `AgentSettingField[]` | Array of field definitions: `{ id, label, hint, description, type: "boolean" \| "select", default, options?: [{ label, value }] }`. |

#### 8. Granular UI Visibility Flags (`ui`)
Fine-grained controls to display or hide individual surfaces and controls:

##### A. Popup Surface
| Flag | Type | Default | Description |
|---|---|---|---|
| `showAuditUI` | `boolean` | `true` | When `false`, hides the **Agent UI** tab (`#dynamicPopup` and the `Dashboard \| Agent UI` view switcher) from the popup, locking the view to the standard **Dashboard** (`#standardPopup`) so users are not distracted. |
| `showPopupHeader` | `boolean` | `true` | Top header bar showing extension icon, name, and action buttons. |
| `showViewSwitcher` | `boolean` | `true` | Segmented tab switcher (`Dashboard` vs `Agent UI`) when a declarative ` ```ui ` block exists. |
| `showStatusCard` | `boolean` | `true` | Status card displaying provider chip, API key status, model name, and alarm interval dropdown. |
| `showKeyStatusBadge` | `boolean` | `true` | "Key Ready" / "Setup Key" status indicator. |
| `showScheduleSummary` | `boolean` | `true` | Schedule interval dropdown inside the popup status card. |
| `showRecentArtifacts` | `boolean` | `true` | "Recent Artifacts" section inside the popup. |
| `showPopupFooter` | `boolean` | `true` | Footer navigation bar (Studio, Artifacts, Side Panel, Logs, Settings). |
| `allowSettingsAccess` | `boolean` | `true` | Gear icon and Settings links that open the options page. |
| `allowSidePanel` | `boolean` | `true` | Side Panel button and links. |

##### B. Global / Cross-Surface
| Flag | Type | Default | Description |
|---|---|---|---|
| `showCosts` | `boolean` | `true` | Estimated USD cost calculations in run completion summaries and stats. |
| `showTokenUsage` | `boolean` | `true` | Input and output token counts in run summaries. |
| `showToolCallDetails` | `boolean` | `true` | Tool execution counts and duration timings. |
| `showHistory` | `boolean` | `true` | Recent action and run history rows. |
| `showVersionBadge` | `boolean` | `true` | Version badge (`vX.Y.Z`) in headers. |
| `showPolicyBadge` | `boolean` | `true` | "Policy Managed" indicator badge when configurations are locked. |
| `showStudio` | `boolean` | `false` | Visual Extension Studio buttons and navigation links. |

##### C. Side Panel Surface
| Flag | Type | Default | Description |
|---|---|---|---|
| `showSidePanelHeader` | `boolean` | `true` | Top header bar in the side panel. |
| `showSidePanelStatusBar` | `boolean` | `true` | Status pill bar in the side panel showing provider, model, and key readiness. |
| `showActivityDrawer` | `boolean` | `true` | Collapsible activity drawer at the bottom of the side panel. |
| `showRecentRuns` | `boolean` | `true` | Recent run execution entries inside the activity drawer. |

##### D. Options Page — Settings Tab
| Flag | Type | Default | Description |
|---|---|---|---|
| `showOnboardingBanner` | `boolean` | `true` | Welcome onboarding card for first-time configuration. |
| `showProviderSelector` | `boolean` | `true` | Provider selection cards (Anthropic, Google, OpenAI). |
| `showApiKeyInput` | `boolean` | `true` | API key input field. |
| `showModelSelector` | `boolean` | `true` | Curated model dropdown. |
| `showProviderTools` | `boolean` | `true` | Provider-native tool toggles. |
| `showPermissionsManager`| `boolean` | `true` | Grouped Chrome capabilities / permissions manager. |
| `showSchedule` | `boolean` | `true` | Background schedule frequency selector. |
| `allowTestConnection` | `boolean` | `true` | "Test Key" verification button. |
| `allowManualRun` | `boolean` | `true` | "Run Now" buttons in popup, side panel, and options. |

##### E. Options Page — Audit & History Tab
| Flag | Type | Default | Description |
|---|---|---|---|
| `showAuditLog` | `boolean` | `true` | Detailed audit log section in the options page. |
| `showAuditStats` | `boolean` | `true` | Aggregated telemetry banner (total runs, success rate, spend). |
| `showAuditFilters` | `boolean` | `true` | Search and trigger filter bar for audit entries. |
| `allowExportAudit` | `boolean` | `true` | "Export JSON" audit download button. |
| `allowClearAudit` | `boolean` | `true` | "Clear Audit Log" button. |

##### F. Artifacts Browser (`artifacts.html`)
| Flag | Type | Default | Description |
|---|---|---|---|
| `allowArtifacts` | `boolean` | `true` | Master switch for the artifacts browser and artifact creation subsystem. |
| `showArtifactStats` | `boolean` | `true` | Summary metrics banner (total artifacts count, disk usage). |
| `showArtifactFilters` | `boolean` | `true` | Kind, date, and keyword search filters. |
| `allowCopyArtifact` | `boolean` | `true` | One-click copy artifact contents button. |
| `allowDownloadArtifact` | `boolean` | `true` | File download button for artifacts. |
| `allowDeleteArtifacts` | `boolean` | `true` | Delete artifact buttons. |

#### 9. Feature Flags (`features`)
Mirrors core capability switches for policy governance:
- `showAuditUI`: When `false`, disables the Agent UI tab in the popup.
- `showProviderSelector`, `showModelSelector`, `showProviderTools`, `showPermissionsManager`, `showSchedule`: Control settings visibility.
- `showAuditLog`, `allowExportAudit`, `allowClearAudit`: Control audit log accessibility.
- `allowSidePanel`, `allowArtifacts`, `allowManualRun`: Control primary runtime capabilities.

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

`examples/` has 29 demo prompts, each in its own folder with a `prompt.md` and a short `README.md` listing the permissions it needs and what it does. They cover the surface — right-click summarisers, tab hygiene variants, focus mode, auto-reading-list, omnibox answers, meeting-prep templates, hourly tab-screenshot diaries, bookmark cleaners, and more.

Try one easily using the `npm run use <example-name>` tool, or package it directly into a ZIP file with `npm run pack <example-name>`. See [`examples/README.md`](examples/README.md) for full instructions.

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
