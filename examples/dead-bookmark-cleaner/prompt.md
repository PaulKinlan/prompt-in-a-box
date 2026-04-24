# Dead Bookmark Cleaner

Every so often, check a batch of the user's bookmarks to see if they still resolve. Flag dead ones — don't delete them.

## On each scheduled run

1. `bookmark_list` to get every bookmark.
2. `storage_get` `deadCheck.cursor` (integer, 0 by default). This is where we left off last run.
3. Take the next 5 bookmarks starting at `cursor`. (Checking 5 per run keeps us polite on hosts and cheap on alarm tick cost.)
4. For each:
   - `tab_open` the URL in an inactive tab (`active: false`).
   - Wait briefly (the agent step itself gives enough time for navigation).
   - `tab_read` on the opened tab. If the text is empty, contains obvious error markers ("can't be reached", "404", "This site can't be reached", "DNS_PROBE_FINISHED"), or the tab's title is `Error` / empty → mark as dead.
   - `tab_close` the tab.
5. Append any dead bookmarks to `OPFS://dead-bookmarks.md` with URL, title, detected reason, timestamp.
6. Advance `cursor` by 5 and wrap to 0 at the end. `storage_set`.
7. If the pass has just wrapped (cursor reset to 0), `notification_show` a single summary: "Dead bookmark check complete. N dead links found this pass — see OPFS dead-bookmarks.md."

## Constraints
- Never delete bookmarks. This is a report, not a cleaner.
- Cap at 5 bookmarks per run — we're incremental on purpose.
- Respect `chrome://` and `file://` URLs by skipping them.

## Required permissions
`bookmarks`, `tabs`, `scripting`, `notifications`.
