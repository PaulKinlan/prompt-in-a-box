# Clipboard Phrase via Command

Keyboard-shortcut-driven phrase library. Press the configured shortcut; get a menu of canned phrases and copy the chosen one to the clipboard.

Because commands in MV3 can only fire one-shot events (no interactive menu), this prompt uses multiple named commands — one per phrase family. The user invokes each with its own shortcut.

## Commands (declared in manifest)

```
"commands": {
  "insert-signature":   { "description": "Copy email signature to clipboard",       "suggested_key": { "default": "Ctrl+Shift+Period" } },
  "insert-thanks":      { "description": "Copy polite thanks to clipboard" },
  "insert-scheduling":  { "description": "Copy scheduling blurb to clipboard" }
}
```

## Phrases

Maintain in `chrome.storage.local` under key `phrases`:

```json
{
  "insert-signature":   "Cheers,\nPaul\n— https://paul.kinlan.me",
  "insert-thanks":      "Thanks — appreciate the details. I'll get back to you shortly.",
  "insert-scheduling":  "Happy to chat — my calendar: https://cal.com/paulkinlan"
}
```

Default values populate on first run if the key is missing.

## On `commands.onCommand` events

1. The event payload has `command` (the command name).
2. Look up the phrase in `phrases[command]`.
3. `clipboard_write` the phrase (via offscreen document).
4. `notification_show` briefly: "Phrase copied: <first 40 chars>".

## Constraints
- Never log phrases anywhere. They may contain personal info.
- If the phrase for a command is missing, notify "No phrase configured for <command>".

## Required permissions
`notifications`, `clipboardWrite`, `offscreen`.

(Commands are declared in manifest's top-level `commands` block, not in `permissions`.)
