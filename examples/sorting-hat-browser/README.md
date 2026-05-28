# Sorting Hat Browser

Automatically categorizes and organizes your browser tabs into dynamic groups based on real-time content analysis and user intent. Keep your workspace clutter-free with intelligent, automated tab routing.

## Trigger
- **Scheduled**: Runs automatically every 15 minutes via a Chrome alarm.
- **Manual**: Can be triggered on-demand via a custom right-click context menu item ("Sort Un-grouped Tabs Now").

## Writes
- Uses `tab_group` to group tabs logically, assigning titles and colors.
- Uses `context_menu_create` to install the manual trigger menu item.
- Uses `storage_set` to remember the mapping of active groups.
- Uses `alarm_set` to schedule automated periodic tab clean-up.

## Reads
- Uses `tab_list` to identify un-grouped open tabs.
- Uses `tab_read` to analyze page contents if titles/URLs are ambiguous.
- Uses `history_search` to infer user intent for recurring topics.
- Uses `storage_get` to retrieve existing group associations.

## Required Permissions
- `tabs`
- `tabGroups`
- `storage`
- `scripting`
- `activeTab`
- `history`
- `alarms`
- `contextMenus`
- `<all_urls>` (Host permission)
