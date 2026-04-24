# Daily Summary

Once a day, in the evening, summarise the user's browsing into an OPFS journal entry. Like a browsing-activity diary that writes itself.

## Trigger

1. `storage_get` `lastDailySummary`. Skip if today's date.
2. Only fire between 21:00 and 23:59 local time.
3. Otherwise do nothing.

## Produce the summary

1. `history_search` with:
   - `text: ""` (match all)
   - `startTime: today at 00:00 (ms since epoch)`
   - `endTime: now`
   - `maxResults: 500`
2. Filter out obvious junk: internal SaaS dashboards the user clearly just keeps open (group by host, if 30+ visits within the day from a single host to the same path, collapse to one entry).
3. Cluster the history into ~5-7 themes via LLM. Each theme gets a name, a 2-sentence description, and the top 3-5 representative URLs.
4. Also pull `reading_list_query` additions from today — mention them in a separate "Saved for later" section.
5. Build the markdown:

   ```markdown
   # YYYY-MM-DD browsing

   ## Themes
   ### <theme name>
   <description>
   - [title](url)

   ## Saved for later
   - [title](url)

   ## Reflection
   <one paragraph on the shape of the day>
   ```

6. Call `artifact_create` with:
   - `kind`: `markdown`
   - `title`: `"Daily summary — YYYY-MM-DD"`
   - `content`: the markdown above
   - `tags`: `["daily-summary", "journal"]`
7. `notification_show`: "Today's browsing journal written — check the artifacts tab."
8. `storage_set` `lastDailySummary: today`.

## Constraints
- No more than one notification per day.
- Don't include URLs that clearly look like local/internal tools (10.*, 192.168.*, localhost, *.internal, *.local).
- Private hosts (maintain a list via `storage_get` on `privateHosts`) are excluded entirely. Empty by default.

## Required permissions
`history`, `readingList`, `notifications`.
