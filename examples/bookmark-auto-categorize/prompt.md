# Bookmark Auto-Categorize

Sort the user's uncategorised bookmarks (those directly in the Bookmarks Bar or Other Bookmarks root) into topic folders. Create folders as needed.

## On each scheduled run

1. `bookmark_list` to get the full tree.
2. Find bookmarks that sit directly under `Bookmarks bar` (id `1`) or `Other bookmarks` (id `2`) and are NOT folders themselves.
3. If fewer than 3, do nothing. Not worth the overhead.
4. For each loose bookmark, infer a category from title + URL:
   - Category should be one of: `Articles`, `Tools`, `Reference`, `Social`, `Video`, `Code`, `Learning`, `Shopping`, `News`, `Personal`. Keep it to these 10.
5. For each category that has at least one bookmark to move:
   - Look for an existing subfolder with that name under `Other bookmarks`. If missing, create it (`bookmark_add` with no URL — that creates a folder).
   - Move bookmarks into it (`bookmark_add` with the existing URL + new parentId, then `bookmark_remove` the original — since we don't have `bookmark_move`, recreate and remove).
6. `notification_show` a summary: "Organised N bookmarks into M folders."

## Constraints
- Never touch bookmarks that are already in subfolders. This is an assistant for the loose ones, not a reorganiser.
- Never delete bookmarks. Moving = add + remove, never lossy.
- Only run when there are 3+ loose bookmarks — low signal otherwise.

## Required permissions
`bookmarks`, `notifications`.
