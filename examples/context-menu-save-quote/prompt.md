# Context Menu: Save Quote

Right-click any selected text → save it as a quote with source attribution to OPFS. Build a commonplace book as you browse.

## Bootstrap

Create context menu item if missing:

- `id: save-quote`
- `title: Save quote`
- `contexts: ["selection"]`

## On click

1. The selection is in `info.selectionText`. The tab info has `url`, `title`.
2. Build the quote markdown:

   ```markdown
   > <selected text>

   — [<title>](<url>)
   *Captured YYYY-MM-DD HH:MM*
   ```

3. Call `artifact_create`:
   - `kind`: `markdown`
   - `title`: first 60 chars of the quote
   - `content`: the markdown above
   - `sourceUrl`: the tab URL
   - `tags`: `["quote", "<source-host>"]` (extract host from URL)
4. `notification_show`: "Quote saved."

## Weekly digest

Once a week (Sunday, gated via `storage_set` `lastQuoteDigest`):
- List artifacts with tag `"quote"` created in the last 7 days (via `storage_get` on the index key `__pib_artifact_index`, filter locally).
- Pick 5-7 most substantive (via LLM judgement on length + content).
- Group thematically if more than one theme.
- Save as a new artifact:
  - `kind`: `markdown`
  - `title`: `"Quote digest — week of YYYY-MM-DD"`
  - `tags`: `["quote-digest"]`

## Constraints
- Never truncate the quote.
- Never capture empty selections — if `selectionText` is empty, skip (this shouldn't happen given `contexts: selection`, but guard anyway).
- Never overwrite the monthly file — always append.

## Required permissions
`contextMenus`, `notifications`.
