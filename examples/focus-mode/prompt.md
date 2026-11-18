# Focus Mode

When the user navigates to a distraction domain during focus hours, close the tab (or warn them) and fire a gentle notification. The goal is a speed bump, not a blocker.

## Config

Maintained in `chrome.storage.local`. Default values:

- `focusHours`: `{ start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }` (Mon–Fri, evaluated in the **user's local time** from `Current local time:` in the user message — never UTC)
- `alwaysActive`: `false` (if `true`, enforce Focus Mode 24/7 regardless of `focusHours`)
- `distractionHosts`: `["twitter.com", "x.com", "reddit.com", "news.ycombinator.com", "youtube.com", "tiktok.com", "instagram.com", "facebook.com"]`
- `graceWindow`: `1800` (seconds — 30-minute session window. First visit in a 30-minute window is free; repeated visits or extra tabs trigger `mode`. Note: if stored `graceWindow` in storage is `<= 120` from an older version and `graceWindowMigrated` is not `true`, upgrade it to `1800` and set `graceWindowMigrated: true`.)
- `mode`: `"warn"` (`"warn"` | `"close"`)

Match hosts by stripping leading `www.` and checking `host === d || host.endsWith("." + d)`.

## Execution (Single `code_mode` Routine)

Run all storage reads, tab checks, and actions in a single `code_mode` script:

1. **Check Focus Hours (Local Time)**:
   - Parse the local `dayOfWeek` and local `HH:MM` provided in `Current local time:` in the user message.
   - Unless `alwaysActive === true`, if today is not in `focusHours.days` or local `HH:MM` is outside `[focusHours.start, focusHours.end]`, do not warn or close tabs (if triggered manually or via UI, update UI metrics via `ui_update` and finish).

2. **Collect Distraction Targets**:
   - Inspect all currently open **unpinned** browser tabs (`pinned === false`) matching `distractionHosts`, as well as any `tabs.onUpdated` (`status: "complete"`) events in the user message.
   - Group currently open unpinned distraction tabs by matched root distraction host `<host>`.

3. **Enforce Speed Bump per `<host>`**:
   - **Case A — Multiple Tabs Open (`openTabsForHost.length >= 2`)**:
     - Having 2+ unpinned tabs open on the same distraction host at the same time is **always** a repeated distraction (never a freebie).
     - Keep the oldest tab (`openTabsForHost[0]`) and target the extra tab(s) (`openTabsForHost.slice(1)`):
       - If `mode === "warn"`: call `notification_show` (`title: "Focus Mode"`, `message: "Focus mode: You have <N> <host> tabs open. Close the extra tab?"`).
       - If `mode === "close"`: close the extra tab(s) via `tab_close` (respecting the 3-tabs-per-minute cap), record an undo snapshot with `action_toast`, and call `notification_show` (`title: "Focus Mode"`, `message: "Focus mode closed extra <host> tab."`).
     - Set `focusGrace:<host>` to `now` (`Date.now()`) and `focusFreebieTab:<host>` to `openTabsForHost[0].id`.
   - **Case B — Single Tab / New Navigation**:
     - Read `lastGrace` = `storage_get("focusGrace:" + host)` and `freebieTabId` = `storage_get("focusFreebieTab:" + host)`.
     - If `lastGrace` is missing OR `(now - lastGrace) > graceWindow * 1000`:
       - First visit in this 30-minute session window is a freebie: set `focusGrace:<host>` = `now` and `focusFreebieTab:<host>` = `tab.id`, and skip warning/closing.
     - Else if `tab.id !== freebieTabId` OR there is a new `tabs.onUpdated` navigation to `<host>` on another tab / reload after the freebie:
       - Repeated visit within the session window!
       - If `mode === "warn"`: call `notification_show` (`title: "Focus Mode"`, `message: "Focus mode: You opened <host> again. Close this tab?"`).
       - If `mode === "close"`: call `tab_close` on `tab.id` (respecting the 3-tabs-per-minute cap) and `notification_show` (`title: "Focus Mode"`, `message: "Focus mode closed <host>."`).
       - Set `focusGrace:<host>` = `now`.

4. **Dashboard Sync**:
   - Call `ui_update` to refresh the `metrics` component with live counts (`Distraction Tabs`, `Mode`, `Focus Window`).

## Constraints
- Never block or warn during non-focus hours (unless `alwaysActive` is `true`).
- Never touch pinned tabs (`pinned: true`).
- Never close more than 3 tabs per minute — track recent close timestamps in storage (`focusCloseTimestamps`) and bail if `>= 3` within the last 60 seconds.

## On `tabs.onUpdated` events (status: complete)
Immediately run the Execution steps above for the newly loaded tab and open tabs.

## Required permissions
`tabs`, `notifications`.

```ui
{
  "title": "Focus Mode",
  "theme": "warm-paper",
  "layoutMode": "stack",
  "themeConfig": {
    "accentColor": "#d97706",
    "cardOpacity": 0.95,
    "blurPx": 8,
    "borderRadiusPx": 10
  },
  "components": [
    {
      "type": "header",
      "text": "Focus Mode",
      "subtitle": "Gentle speed bump for distraction sites during focus hours."
    },
    {
      "type": "metrics",
      "id": "focus_metrics",
      "metrics": [
        {
          "label": "Distraction Tabs",
          "value": "0",
          "subvalue": "monitored"
        },
        {
          "label": "Mode",
          "value": "Warn",
          "subvalue": "speed bump"
        },
        {
          "label": "Session Grace",
          "value": "30m",
          "subvalue": "1st visit free"
        }
      ]
    },
    {
      "type": "select",
      "id": "mode",
      "label": "Enforcement Mode",
      "storageKey": "state:mode",
      "options": [
        { "label": "Warn (Notification)", "value": "warn" },
        { "label": "Close Repeated Tabs", "value": "close" }
      ]
    },
    {
      "type": "switch",
      "id": "alwaysActive",
      "label": "Enforce 24/7 (Ignore Focus Hours)",
      "hint": "Active even outside 09:00–17:00 Mon–Fri",
      "storageKey": "state:alwaysActive",
      "checked": false
    },
    {
      "type": "button",
      "id": "btn_run_agent",
      "text": "Run Focus Mode Now",
      "intent": "primary",
      "action": "trigger-run",
      "payload": {
        "command": "run"
      }
    },
    {
      "type": "run-progress",
      "id": "run_progress",
      "steps": [
        "Check local focus hours & session state",
        "Scan open tabs for distraction domains",
        "Warn or close repeated distraction tabs"
      ]
    },
    {
      "type": "action-history",
      "id": "recent_actions",
      "text": "Recent Actions & Undo",
      "limit": 15,
      "showUndoAll": true,
      "undoAllLabel": "Undo Last Action"
    }
  ]
}
```
