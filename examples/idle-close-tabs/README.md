# idle-close-tabs

Event-driven. When the user has been idle 30+ minutes, snapshots open tabs to OPFS and closes non-pinned ones. Pairs well with a manual `restore` flow (not implemented in v1).

- **Trigger:** `idle.onStateChanged` (queued)
- **Required permissions:** `tabs`, `idle`, `notifications`
- **Writes:** `OPFS://session-snapshots/YYYY-MM-DD-HH-MM.json`
- **Side effects:** closes tabs aggressively while user is away; notifies on return
