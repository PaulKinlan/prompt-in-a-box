# Dedupe Tabs

When the user has multiple tabs open to the exact same URL, close all but the oldest (or the active one, if present).

## On each scheduled run

1. `tab_list` all tabs.
2. Group by normalised URL. Normalise by stripping:
   - Trailing slashes
   - URL fragments (`#...`)
   - Common tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`)
3. For each group with 2+ tabs:
   - If one is `active: true`, keep that one.
   - Otherwise keep the tab with the lowest `id` (oldest).
   - `tab_close` the rest.
4. Fire a single `notification_show` summarising the cleanup: "Closed N duplicate tabs across M URLs" (only if N > 0).

## Constraints
- Never close pinned tabs.
- Never close tabs in audible state (`audible: true`) — the user is probably listening to something.
- Never close the only tab in a window; if dedupe would empty a window, skip.

## Required permissions
`tabs`, `notifications`.
