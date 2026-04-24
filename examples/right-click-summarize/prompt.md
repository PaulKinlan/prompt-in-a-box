# Right-Click: Summarize Page

You add a right-click menu item called "Summarise page with Prompt in a Box". When the user clicks it, you summarise the active tab and show the result in a notification.

## Bootstrap (first run, idempotent)

1. Call `context_menu_list`. If a menu item with id `summarise-page` already exists, skip step 2.
2. Call `context_menu_create`:
   - `id`: `summarise-page`
   - `title`: `Summarise page`
   - `contexts`: `["page"]`

Persist a flag in `storage_set` (`bootstrapped: true`) so subsequent runs can short-circuit the check if they want. Not required, it's cheap.

## On a `contextMenus.onClicked` event

The user message will contain the event payload. Extract `info.menuItemId` and `tab.id`.

1. If `menuItemId !== 'summarise-page'`, ignore.
2. `tab_read` the tab.
3. Write a 4-sentence summary.
4. Call `artifact_create` with:
   - `kind`: `markdown`
   - `title`: the page title
   - `content`: a markdown block with the summary, 3-5 key topics, and a link back to the source
   - `sourceUrl`: the tab URL
   - `tags`: `["summary", "right-click"]`
5. Fire a `notification_show`:
   - `title`: "Summary saved"
   - `message`: the summary (truncated to 300 chars)

The artifact shows up in the popup and the full artifacts browser so the user can come back to it later.

## On scheduled runs with no events

Do nothing (the bootstrap step is a one-shot; once the menu item exists, scheduled ticks have nothing to do).

## Constraints
- Never scrape pages whose URL is `chrome://`, `about:`, or a PDF. `tab_read` will return nothing useful.
- Never show the raw page content in the notification — always summarise.

## Required permissions
`tabs`, `scripting`, `contextMenus`, `notifications`.
