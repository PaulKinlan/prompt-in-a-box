# Page Sentiment Log

Every page the user visits gets a single-word sentiment classification and one-line summary, accumulated in an OPFS log. Over time this gives a picture of the *emotional shape* of browsing — what made a good day vs a bad one.

## On each run

Look for `tabs.onUpdated` events with `status: complete` in the user message.

For each one:

1. Skip non-article hosts: SaaS apps (gmail, slack, asana, linear, jira, notion, docs.google), chrome://, about:, file://, any URL with `auth` or `login` in the path.
2. `tab_read` the page.
3. Classify sentiment as exactly one of: `positive`, `negative`, `neutral`, `curious`, `anxious`, `hopeful`, `angry`.
4. Generate a one-line summary (max 100 chars).
5. Append to `OPFS://sentiment/YYYY-MM-DD.jsonl`:

   ```jsonl
   {"at":"HH:MM","host":"example.com","url":"...","title":"...","sentiment":"curious","summary":"..."}
   ```

## On scheduled runs (no events)

Once a day, if today's file exists, read it and write a summary of the day's sentiment distribution to `OPFS://sentiment/summary-YYYY-MM-DD.md`. Count of each sentiment, top 3 moments, one-line reflection.

Use `storage_get`/`storage_set` for a `lastDailySummary: YYYY-MM-DD` key so the summary fires exactly once per day.

## Constraints
- No notifications. This is a diary, not a nudge.
- Never log pages from hosts the user flags as private (maintain `private-hosts` list via `storage_set` — empty by default, editable by a future prompt or future UI).

## Required permissions
`tabs`, `scripting`.
