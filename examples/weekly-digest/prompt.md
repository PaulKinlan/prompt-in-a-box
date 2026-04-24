# Weekly Digest

Every Sunday evening, summarise what the user bookmarked and added to their reading list over the past 7 days.

## Trigger

On each scheduled run:

1. Check `storage_get` `lastDigest` (ISO date). If it's Sunday and it's ≥ 18:00 local time and `lastDigest` is not today, proceed. Otherwise do nothing.
2. Compute date range: now - 7 days → now.

## Produce the digest

1. `bookmark_list`, filter to bookmarks created in the last 7 days (use `dateAdded`).
2. `reading_list_query`, filter to entries where `creationTime` falls in the last 7 days.
3. Group bookmarks by inferred topic (3-5 topic clusters).
4. For reading list items, group by "read" vs "unread".
5. Write to `OPFS://digests/YYYY-MM-DD.md`:

   ```markdown
   # Week of YYYY-MM-DD

   ## Bookmarks added (N)
   ### <topic>
   - [title](url)

   ## Reading list — read this week (N)
   - [title](url)

   ## Reading list — still to read (N)
   - [title](url) (added Mon)

   ## Reflection
   <one-paragraph summary of themes>
   ```

6. `notification_show`: "Weekly digest ready — OPFS digests/<filename>".
7. `storage_set` `lastDigest: today`.

## Constraints
- Only fires once per week. Belt and braces via `lastDigest`.
- Empty weeks (no new bookmarks, no reading list changes) still produce a digest — write it with "Quiet week" instead of the sections.

## Required permissions
`bookmarks`, `readingList`, `notifications`.
