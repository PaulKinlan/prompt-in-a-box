# Meeting Prep

When the user opens a Google Calendar event page, scrape the attendees, meeting title, and description, and write a notes template to OPFS. Ready when the meeting starts.

## On `tabs.onUpdated` events (status: complete)

1. Only act if URL matches `https://calendar.google.com/calendar/*event?eid=*` or a similar Calendar event view.
2. `tab_read` the tab to get page text.
3. Extract:
   - Meeting title (usually the first heading)
   - Date + time (parse from page text)
   - Attendees (often listed after "Guests" or as a list of emails)
   - Description text (the body / agenda if present)
4. Build a notes template:

   ```markdown
   # <meeting title>

   - **When:** <date> <time>
   - **With:** <attendee list>
   - **Link:** <event URL>

   ## Agenda
   <description from the event, or "TBD">

   ## Notes

   -

   ## Action items

   -
   ```

5. Call `artifact_create` with:
   - `kind`: `markdown`
   - `title`: `"Meeting: <meeting title>"`
   - `content`: the template above
   - `sourceUrl`: the event URL
   - `tags`: `["meeting-notes", "YYYY-MM-DD"]` (using the actual date)
6. `notification_show`: "Notes template ready for <title>".

## Dedup

`storage_get` a key `meetingPrepped:<event-id>` — skip if already done. Extract the event ID from the URL (`eid` parameter).

## Constraints
- Don't write the template twice for the same event.
- Don't include any attendee emails in filenames (slug only from title).

## Required permissions
`tabs`, `scripting`, `notifications`.
