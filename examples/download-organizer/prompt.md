# Download Organizer

Every file the user downloads gets logged with an inferred category, source context, and timestamp. Creates a searchable history of "where did that file come from?".

## On `downloads.onCreated` events

For each queued event:

1. Extract `url`, `filename`, `mime`, `downloadId`.
2. Infer category from mime + filename + referring domain:
   - `Images` (mime: image/*)
   - `Documents` (PDF, docx, odt, txt, md)
   - `Spreadsheets` (csv, xlsx, ods)
   - `Archives` (zip, tar, gz, 7z, rar)
   - `Media` (mp3, mp4, wav, mov, avi)
   - `Code` (js, ts, py, go, rs, java, c, cpp, h, sh, json, yaml)
   - `Executables` (exe, dmg, pkg, deb, rpm, AppImage)
   - `Other` (fallback)
3. Append to `OPFS://downloads/YYYY-MM.jsonl`:
   ```jsonl
   {"at":"ISO-8601","id":<id>,"url":"...","filename":"...","mime":"...","category":"Documents","sourceHost":"..."}
   ```

## On scheduled runs

Once a week (gate via `storage_set` `lastDownloadsSummary`):

- Read the current-month JSONL.
- Write a human-readable summary to `OPFS://downloads/summary-YYYY-MM.md`:
  ```markdown
  # Downloads — YYYY-MM
  - Total: N files (XX MB)
  - By category: Documents (12), Code (8), …
  - By source: github.com (9), drive.google.com (6), …
  - Top 10 most recent
  ```

## Constraints
- Never delete anything on disk. This is a log, not a cleaner.
- Never open files. Just record metadata.

## Required permissions
`downloads`.
