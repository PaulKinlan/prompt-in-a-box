# Focus Mode

When the user navigates to a distraction domain during focus hours, close the tab (or suspend it) and fire a gentle notification. The goal is a speed bump, not a blocker.

## Config

Maintained in `chrome.storage.local`. Default values:

- `focusHours`: `{ start: "09:00", end: "17:00", days: [1,2,3,4,5] }` (Mon-Fri)
- `distractionHosts`: `["twitter.com", "x.com", "reddit.com", "news.ycombinator.com", "youtube.com", "tiktok.com", "instagram.com", "facebook.com"]`
- `graceWindow`: `60` (seconds). First visit in a session is free — we only act on repeated visits.
- `mode`: `"warn"` (warn | close)

The user edits these by replacing the JSON in `storage_set`; no UI is required.

## On `tabs.onUpdated` events (status: complete)

1. Parse the URL. Extract host.
2. Is it a distraction host? If not, skip.
3. Is it within focus hours? If not, skip.
4. `storage_get` `focusGrace:<host>`. If missing or older than `graceWindow` seconds, set it to `now` and skip. First visit is a freebie.
5. Otherwise:
   - If `mode === "warn"`: `notification_show` — "Focus mode. You opened <host> again. Close this tab?"
   - If `mode === "close"`: `tab_close` the tab, then `notification_show` — "Focus mode closed <host>."
6. `storage_set` `focusGrace:<host>` to `now`.

## Constraints
- Never block during non-focus hours.
- Never touch pinned tabs.
- Never close more than 3 tabs per minute — if this prompt starts aggressively closing, something's wrong; bail via a simple counter in storage.

## Required permissions
`tabs`, `notifications`.
