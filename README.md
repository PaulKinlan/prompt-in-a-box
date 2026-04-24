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
    tab-list.ts         – one file per Chrome API surface
    tab-close.ts
    tab-open.ts
    tab-focus.ts
    notification-show.ts
    bookmark-search.ts
    history-search.ts
    storage-get.ts
    storage-set.ts
    opfs-read.ts
    opfs-write.ts
    opfs-list.ts
    alarm-set.ts
  stubs/
    mcp-sdk.ts          – build-time stubs (agent-do's MCP imports are node-only)
    node-only.ts
    node-module.ts
build.js                – esbuild driver → dist/background.js, dist/popup.js
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

On each alarm tick (or **Run now** from the popup) the service worker:

1. Loads `prompt.md` via `chrome.runtime.getURL` + `fetch`.
2. Builds a `ToolSet` of only the Chrome APIs granted by the manifest (see `src/tools/index.ts` — each permission unlocks a bucket).
3. Calls [`agent-do`'s `runAgentLoop`](https://www.npmjs.com/package/agent-do) with an Anthropic model, the prompt as the system message, and the tool set.
4. `agent-do` runs the tool-use loop until the model returns a final message with no tool calls (or `maxIterations` is reached).
5. A short summary is appended to an in-memory log for the popup to show.
6. The SW exits. Chrome kills it shortly after.

`agent-do` handles the provider abstraction, tool-call marshalling, permissions, and usage tracking. This project contributes the host wiring: which Chrome APIs are tools, how state persists, when the loop fires. That separation is the point.

## Swapping in a different prompt

Replace `prompt.md`. That's it. Everything else stays the same.

If a new prompt wants additional capabilities (history, scripting, downloads, clipboard), add the corresponding permission in `manifest.json`'s `optional_permissions` and add a matching tool file in `src/tools/`. The permission boundary is the contract.

## Security notes

- API keys live only in `chrome.storage.local`. They never leave the browser except as outbound calls to endpoints declared in `host_permissions`.
- The extension's CSP (`extension_pages`) restricts `script-src` and `connect-src`, so even a compromised popup can't exfiltrate to an arbitrary origin.
- `prompt.md` is in `web_accessible_resources` so the SW can `fetch` it via `chrome.runtime.getURL`. It's only accessible from the extension origin.
- Every tool the model can call is gated by a Chrome permission at the browser boundary. Removing a permission removes the capability without a code change.
- agent-do's MCP server mounting is stubbed out in this build (MCP transports need `node:child_process`, which doesn't exist in a service worker). Leave `mcpServers` unset in the loop config.

## What's still to do

This is a proof-of-concept, not a product:

- Only Anthropic is wired. Google and OpenAI adapters would be a small addition via `@ai-sdk/google` / `@ai-sdk/openai`.
- The tool set covers the commonly-used chrome.* surface but isn't exhaustive (scripting, downloads, clipboard, tab screenshots, window management, etc. are easy additions).
- Tools aren't auto-generated from the manifest's `permissions` array — adding a permission still requires writing its tool file.
- No tests yet.

## License

MIT.
