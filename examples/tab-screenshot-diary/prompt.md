# Tab Screenshot Diary

Every hour during the day, screenshot the active tab. Creates a "photo album" of what the user was looking at. Useful for ambient review — scroll through yesterday and see the shape of the day.

## Trigger

On each scheduled run:

1. `storage_get` `lastScreenshotAt` (ms since epoch).
2. If `now - lastScreenshotAt < 55 * 60 * 1000`, skip (sub-hour cadence; the 55-min buffer accounts for alarm jitter).
3. Only between 08:00 and 22:00 local time.

## Capture

1. `window_list` to get the currently focused window (the one with `focused: true`).
2. If none, skip (all windows minimised).
3. `tab_screenshot` with that `windowId`, no quality (PNG, lossless).
4. The tool saves to OPFS and returns the path.
5. Also append to `OPFS://diary-index.md`:
   ```markdown
   - HH:MM — [<tab title>](<path>) — <tab URL>
   ```
6. `storage_set` `lastScreenshotAt: now`.

## Weekly prune

Once a week (gate via `storage_set` `lastScreenshotPrune`):

- `opfs_list` on `screenshots/`. Anything older than 30 days — delete.
- Keep daily summaries and index files.

## Constraints
- No sound, no notification — ambient by design.
- Don't screenshot `chrome://` or `about:` URLs. They leak nothing useful.
- Skip if the tab URL is on the user's private hosts list (check `privateHosts` in storage).

## Required permissions
`tabs`, `scripting`.
