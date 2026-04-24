# Idle Close Tabs

When the user is idle for more than 30 minutes, snapshot their current session and close non-pinned tabs. When they come back, they can restore from the snapshot.

## On `idle.onStateChanged` events

If the event state is `idle` or `locked` and it's been that way for at least 30 minutes:

1. Check `storage_get` for `lastIdleClose`. Skip if it fired within the last 2 hours (don't hammer).
2. `tab_list` → filter to non-pinned, non-audible, non-active-in-its-window tabs.
3. Write the full list (tabId, url, title, windowId, pinned, groupId) to `OPFS://session-snapshots/YYYY-MM-DD-HH-MM.json`.
4. `tab_close` each tab in the filtered list.
5. `notification_show`: "Closed N tabs while you were away. Snapshot: <path>".
6. `storage_set` `lastIdleClose: now`.

## On `omnibox.onInputEntered` (if you add an omnibox keyword)

If the user types `restore` in the configured omnibox keyword, read the most recent snapshot from OPFS, `tab_open` each URL in the correct window, re-pin where needed.

Implementation for v1: omit the restore — snapshot is enough. Manual restore by reading the JSON.

## Constraints
- Never close pinned tabs.
- Never close audible tabs.
- Never close the only tab in a window (at least one tab per window survives).
- Cap at 50 tabs per sweep. Above that, something's unusual — write the snapshot but skip closure.

## Required permissions
`tabs`, `idle`, `notifications`.
