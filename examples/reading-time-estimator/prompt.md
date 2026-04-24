# Reading Time Estimator

When the user navigates to a long-form article, estimate how long it'll take to read and notify them if it's over 5 minutes. Avoids the "tab left open for 3 weeks" trap.

## On each run

The user message contains queued events. Look for `tabs.onUpdated` events with `status: "complete"`.

For each one:

1. Skip obvious non-articles: URLs on `*.google.com`, `*.github.com`, `*.youtube.com`, `mail.*`, anything with `docs`, `gmail`, `slack`, `discord`, `asana`, `linear` in the host.
2. Check `storage_get` for a key `notified:<tabId>:<url>`. If already notified, skip.
3. `tab_read` the tab.
4. Count words in the main text. Estimate reading time at 230 words per minute.
5. If estimate ≥ 5 min, `notification_show`: "Reading time: ~N min — <title>".
6. `storage_set` `notified:<tabId>:<url>` = true so we don't re-notify on every minor DOM update.

Clean up stale `notified:*` keys once a day (on any run where the date has changed since the last cleanup, run through `storage_get` for the cleanup-date key).

## Constraints
- Never interrupt with anything under 5 minutes. The whole point is to flag the lengthy ones.
- Never notify more than once per URL per tab.

## Required permissions
`tabs`, `scripting`, `notifications`.
