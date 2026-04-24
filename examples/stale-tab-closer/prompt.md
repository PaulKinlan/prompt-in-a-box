# Stale Tab Closer

Close tabs that haven't been touched in 24 hours (configurable). Protects pinned, audible, and recently-active tabs.

## Configurable
- Staleness threshold: **24 hours**.
- Grace period before first sweep: **6 hours** (so newly-opened tabs don't get axed on the first run).

## On every run

1. Get queued `tabs.onActivated` + `tabs.onUpdated` events from the user message.
2. For each, update `storage_set` key `lastTouch:<tabId>` to the event timestamp (or `now` if missing).
3. `tab_list` all tabs.
4. For each tab:
   - Read `lastTouch:<tabId>` from storage.
   - If missing, initialise to `now` (start the clock).
   - If `now - lastTouch > 24h` and tab is not pinned, not audible, not active in any window → `tab_close` it.
5. Clean up `lastTouch:<tabId>` keys for tabs that no longer exist (pass over all stored keys, drop orphans).

## One-time bookkeeping

On the very first run (detect via `storage_get` on `bootstrapAt` — set it to `now` if absent), don't close anything. Just record `lastTouch` for every existing tab. The sweep starts on the next run after the grace period.

## Constraints
- Never touch pinned tabs.
- Never touch `audible: true` tabs.
- Never close the currently active tab in any window.
- Never close more than 10 tabs in a single run — cap to avoid "where did my session go".

## Required permissions
`tabs`.
