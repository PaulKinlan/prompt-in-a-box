# focus-mode

Event-driven. During configured focus hours, notifies (or closes) when a distraction-list domain is visited beyond a grace window. Silent outside focus hours.

- **Trigger:** `tabs.onUpdated`
- **Required permissions:** `tabs`, `notifications`
- **Config:** `chrome.storage.local` — edit `focusHours`, `distractionHosts`, `mode` (`warn` | `close`)
- **Side effects:** may close tabs in `close` mode; always notifies after the grace window
