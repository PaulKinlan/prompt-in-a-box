# clipboard-phrase-via-command

Event-driven. Keyboard shortcut → phrase → clipboard. Needs a `commands` block in the manifest (one entry per phrase).

- **Trigger:** `commands.onCommand`
- **Required permissions:** `notifications`, `clipboardWrite`, `offscreen`
- **Manifest addition:** top-level `commands` block with one entry per shortcut
- **Side effects:** clipboard write, brief notification

Declaring a command doesn't require a permission — it's a separate manifest block. See [Chrome Extensions: commands](https://developer.chrome.com/docs/extensions/reference/api/commands).
