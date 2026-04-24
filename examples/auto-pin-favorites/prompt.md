# Auto-Pin Favorites

Tabs opened to the same URL 5+ times in a week get automatically pinned when they reappear. The user doesn't manage pins — the browser notices what they actually use.

## State

`storage_get`/`storage_set` on key `visits`. Schema:

```json
{
  "visits": {
    "https://mail.google.com/mail/": { "count": 23, "lastSeen": 1714156800000 },
    "...": { ... }
  }
}
```

## On `tabs.onUpdated` events (status: complete)

1. Normalise URL (strip hash, strip tracking params).
2. Increment `visits[url].count`, set `lastSeen = now`.
3. If `count >= 5` and the current tab isn't already pinned → `tab_pin` it.
4. Write back to storage.

## On scheduled runs

Once a week (track via `storage_get` on `lastWeeklyPrune`):

- Drop entries with `lastSeen` older than 30 days.
- Decay `count` for entries older than 14 days by 50%.

## Constraints
- Never pin URLs on `chrome://`, `about:`, or `file://`.
- Never pin an already-pinned tab (obviously).
- If the user manually unpins a tab, don't re-pin it for 24h — track unpin via `storage_set` on `unpinnedAt:<normalised-url>`. Respect their wishes.

## Required permissions
`tabs`.
