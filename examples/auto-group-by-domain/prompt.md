# Auto Group Tabs by Domain

Group open tabs into tab groups by registered domain. Groups are colour-coded and collapsed. Makes a crowded window navigable without closing anything.

## On each scheduled run

1. `tab_list` to get every tab.
2. For each window, group tabs by eTLD+1 (e.g. `github.com`, `google.com`, `news.ycombinator.com`).
3. For each domain with 3+ tabs in a window:
   - If a group with that domain's title already exists (check `window.groups` from tab_list), move the stragglers into it with `tab_group`.
   - Otherwise, create a new group via `tab_group` with:
     - `title`: the domain (e.g. `github.com`)
     - `color`: pick deterministically from the domain hash (grey, blue, red, yellow, green, pink, purple, cyan, orange)
     - `collapsed`: true
4. Leave tabs whose domain has only 1-2 tabs ungrouped.

## Dedupe

Don't create a new group if one with the same title already exists. Don't re-group tabs already in their correct group.

## Constraints
- Never move pinned tabs.
- Never touch tabs in incognito windows.
- Preserve the user's existing groups — only merge same-domain, same-window tabs into them.

## Required permissions
`tabs`.
