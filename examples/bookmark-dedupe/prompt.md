# Bookmark Dedupe

Find duplicate bookmarks (same normalised URL) and produce a report. Doesn't delete — just flags for the user to decide.

## On each scheduled run

1. `bookmark_list` to get every bookmark.
2. Group by normalised URL:
   - Lowercase the host.
   - Strip trailing slashes.
   - Strip fragments (`#...`).
   - Strip tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`).
3. For each group with 2+ entries, record:
   - The normalised URL
   - All duplicate bookmark IDs + their parent folder paths
4. If no duplicates, do nothing.
5. Overwrite `OPFS://bookmark-dupes.md` with a fresh report:

   ```markdown
   # Duplicate bookmarks — <today>

   ## <normalised URL>
   - `<id>` in `<folder path>` — "<title>"
   - `<id>` in `<folder path>` — "<title>"
   ```

6. `notification_show`: "Found N duplicate bookmark sets — report in OPFS bookmark-dupes.md" (only if N > 0 and it changed from last run).

## Constraints
- Never delete bookmarks.
- Re-run cheaply: overwriting the report is fine.
- Dedupe is by URL, not title. Two bookmarks with the same URL but different titles are still duplicates.

## Required permissions
`bookmarks`, `notifications`.
