# Bookmark & History Explorer

**Description**: Easily search through your saved bookmarks and browsing history to quickly find the exact pages you are looking for.

This demo showcases how an agent can securely search your local browser data to help you locate lost pages or quickly pull up saved references. It consolidates results from both Bookmarks and History and presents them in a clean Markdown artifact.

## Trigger
- Manual invocation with a search query or context.

## Required Permissions
- `storage`: For keeping track of recent searches or user preferences.

## Optional Permissions
- `bookmarks`: Required to search through saved bookmarks.
- `history`: Required to search through browsing history.

## Writes
- `artifact_create`: Generates a Markdown document containing the search results.
- `storage_set`: Saves preferences or search history.

## Side Effects
- Creates output artifacts within the extension. No changes are made to the browser's actual bookmarks or history.