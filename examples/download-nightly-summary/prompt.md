# Download Nightly Summary

Once a day in the evening, summarise what the user downloaded that day and fire a single notification. Good for end-of-day review.

## Trigger gate

On each scheduled run:

1. `storage_get` `lastNightlySummary`. If it's today's date, do nothing.
2. Only fire between 20:00 and 23:00 local time.
3. Otherwise do nothing.

## Produce summary

1. `download_list` with `orderBy: ['-startTime']` and a large enough limit (say 100).
2. Filter to downloads whose `startTime` is today.
3. If zero, write "No downloads today." and skip the notification.
4. Otherwise build a one-line-per-download summary:
   ```markdown
   # Downloads — YYYY-MM-DD
   - 09:14 — [filename](localUrl) from github.com (1.2 MB)
   - 11:03 — …
   ```
5. Append to `OPFS://downloads/daily-YYYY-MM-DD.md`.
6. `notification_show`: "N files downloaded today".
7. `storage_set` `lastNightlySummary: today`.

## Constraints
- No duplicates per day.
- Truncate filenames in the notification (first 40 chars).

## Required permissions
`downloads`, `notifications`.
