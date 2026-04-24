# Prompt in a Box

A Chrome extension whose entire behaviour lives in a markdown file.

The whole idea: a `.crx` is a zip file plus a manifest. It already has a permission model, a sandbox, a distribution channel, and a runtime that wakes on schedule. If you drop a prompt into that zip alongside a generic agent loop, you've got a distributable prompt-program. The manifest declares what the agent can do. The prompt declares what the agent should do. Swap the prompt for a different behaviour file and the same extension becomes a different tool.

This repo is a working minimum of that pattern. It ships with one example prompt (a tab-hygiene agent) so you can see the shape end-to-end.

## Layout

```
manifest.json       – permissions, host_permissions, CSP, alarm defaults
prompt.md           – the program. swap this for a different behaviour
background.js       – MV3 service worker: alarms, run-loop trigger, logging
loop.js             – generic provider-agnostic agent loop (anthropic today)
tools.js            – Chrome APIs exposed as model-callable tools
config.js           – BYO API key + per-user settings via chrome.storage
popup.html/js       – settings UI, run-now button, recent-runs log
icon.png            – placeholder icon
```

Nothing in `background.js`, `loop.js`, `tools.js`, `config.js`, or `popup.*` is specific to tab hygiene. Replace `prompt.md` with a different set of instructions and the same infrastructure runs a different agent.

## Install (unpacked)

1. Get an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/).
2. Clone this repo.
3. In Chrome, go to `chrome://extensions`, turn on **Developer mode** (top-right), click **Load unpacked**, and select this directory.
4. Click the extension's toolbar icon. Paste your API key. Click **Save**, then **Run now**.
5. If you currently have more than 20 tabs open, you should see a desktop notification within a few seconds.

The extension then runs itself on a 30-minute alarm (configurable in the popup).

## Why MV3 service workers are a surprisingly good agent runtime

- **Event-driven.** `chrome.alarms` wakes the service worker on schedule. No long-running process, no wasted memory between runs. When the loop finishes, the SW terminates.
- **Sandboxed.** No DOM access from the SW. No `eval`. No inline scripts under the extension's CSP. No network beyond what `host_permissions` explicitly allows.
- **Persistent state without a server.** `chrome.storage.local` is per-extension, syncs nothing, keeps a few MB. Enough for most small agent state.
- **Declarative capabilities.** The manifest lists exactly which APIs the extension (and therefore the prompt) can touch. If a prompt demands a capability the manifest didn't ask for, the tool call fails at the browser boundary.

The post that introduces this demo — [where prompts run](https://aifoc.us/where-prompts-run) — argues the host is now the interesting part of an agent system. The CRX is one of those hosts, and it happens to already have almost everything you need.

## How the loop works

On each alarm tick (or **Run now** from the popup) the service worker:

1. Loads `prompt.md` via `chrome.runtime.getURL` + `fetch`.
2. Builds the tool list by mapping Chrome APIs to a JSON-schema surface (`tools.js`).
3. Opens a short tool-use loop against the provider's chat endpoint. Each iteration: model calls tools, background executes them, results fed back. Stops at 8 steps or when the model stops calling tools.
4. Writes a summary line to the in-memory log so the popup can show what happened.
5. Exits. The SW is killed by Chrome shortly after. No daemon, no heartbeat.

The loop is deliberately ~100 lines of code (`loop.js`). It's not a full agent framework. For anything production-sized swap it for [agent-do](https://github.com/PaulKinlan/agent-do) once that ships a browser-first build.

## Swapping in a different prompt

Replace `prompt.md`. That's it. Everything else stays the same. Some prompts will want additional permissions (e.g. `history`, `bookmarks`, `scripting`, `downloads`, `activeTab`) — add those to the manifest and the tools file will need new entries that expose the matching APIs. The permission model is the contract.

## Security notes

- API keys are stored only in `chrome.storage.local`. They never leave your browser except as an outbound call to the provider endpoint declared in `host_permissions`.
- The extension's CSP (`extension_pages`) restricts script/connect sources, so a compromised popup can't exfiltrate data to an arbitrary origin.
- `prompt.md` is declared in `web_accessible_resources` so the SW can `fetch` it via `chrome.runtime.getURL`. It is not exposed to regular web pages (extension origin only).
- Every tool the model can call is gated by a Chrome permission. If the manifest doesn't grant `tabs`, `list_tabs` returns an error and the model sees that in its tool-result; it can't escape the sandbox.

## What's still to do

This is a proof-of-concept, not a product:

- Only Anthropic is wired in `loop.js`. Google and OpenAI adapters are stubbed as TODOs — same loop shape, different wire format.
- The tools in `tools.js` match the example prompt. A generic "declare permissions → tools auto-derived" pass would be a natural next step.
- The popup UI is utilitarian. A richer one could show the live agent trace, the prompt source, and a dry-run mode.
- No tests yet.

## License

MIT.
