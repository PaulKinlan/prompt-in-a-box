# Context Menu: Save Quote

Right-click any selected text → save it as a quote with source attribution to OPFS. Build a commonplace book as you browse.

## Bootstrap

Create context menu item if missing:

- `id: save-quote`
- `title: Save quote`
- `contexts: ["selection"]`

## On click

1. The selection is in `info.selectionText`. The tab info has `url`, `title`.
2. Append to `OPFS://quotes/YYYY-MM.md`:

   ```markdown
   ## "<selected text>"

   — [<title>](<url>)
   *Captured YYYY-MM-DD HH:MM*

   ```

3. `notification_show`: "Quote saved (N quotes this month)".

## Weekly digest

Once a week (Sunday, gated via `storage_set` `lastQuoteDigest`), write a "best of" to `OPFS://quotes/digest-YYYY-WW.md`:
- Pick 5-7 most substantive quotes from the week (via LLM judgement on length + content).
- Group thematically if more than one theme.

## Constraints
- Never truncate the quote.
- Never capture empty selections — if `selectionText` is empty, skip (this shouldn't happen given `contexts: selection`, but guard anyway).
- Never overwrite the monthly file — always append.

## Required permissions
`contextMenus`, `notifications`.
