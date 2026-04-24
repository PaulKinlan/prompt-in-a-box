# Examples

Each folder here is a different program for the same extension. The folder contains a `prompt.md` (the program itself) and a short `README.md` (what it does, which manifest permissions it needs, any caveats).

## How to try one

1. Pick an example, say `summarize-on-navigate/`.
2. Copy its `prompt.md` to the repo root, replacing the default `prompt.md`.
3. Open the example's `README.md` and make sure `manifest.json` lists every permission under **Required permissions** (move any from `optional_permissions` to `permissions`, or grant them at runtime via the options page).
4. Run `npm run build` and reload the extension at `chrome://extensions`.
5. Open the toolbar popup, click **Run now** (or wait for the alarm / event).

## What each example demonstrates

- **Schedule-driven** — runs every alarm tick. Good for housekeeping, summaries, reports.
- **Event-driven** — wakes on a specific Chrome event (context menu click, tab update, navigation completion, download finished, etc.). Good for reactions.
- **Mixed** — does a small amount on every tick, reacts to specific events when they fire.

The point of these examples isn't that any one of them is production-ready. It's that **the same code** runs all of them. Swap `prompt.md` and the same extension becomes a different tool. That's the whole idea.

## Writing your own

`prompt.md` is just a system prompt for an [agent-do](https://www.npmjs.com/package/agent-do) loop. You get tools for whatever manifest permissions the user has granted — see the main [README](../README.md) for the tool catalogue. The user message on each run is either `"Begin your scheduled run now."` or, if Chrome events fired since the last run, a summary of them that looks like:

```
Chrome events have fired since your last run. Decide what, if anything, to act on.

  - 2026-04-24T18:42:54.000Z [tabs.onUpdated] {"tabId":42,"url":"https://…","status":"complete"}
  - 2026-04-24T18:42:56.000Z [contextMenus.onClicked] {"info":{"menuItemId":"summarise",…},"tab":{…}}
```

The prompt decides what to do. Create context menus in one run and handle their clicks in another. Watch for new bookmarks and react on the next tick. Hold state across runs via `storage_get` / `storage_set` or OPFS (`opfs_read` / `opfs_write`).

## Not shipped in the zip

These examples are excluded from `npm run pack`. The zip only ships with the `prompt.md` sitting at the repo root — whichever one that is.
