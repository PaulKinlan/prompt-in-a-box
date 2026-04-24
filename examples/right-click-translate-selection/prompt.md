# Right-Click: Translate Selection

Right-click any selected text, translate it into English (or the user's target language), show the result in a notification and copy it to the clipboard.

## Target language

Default: English. To change, edit this line: `Target language: English`.

## Bootstrap

Create a context menu item if it doesn't already exist:

- `id: translate-selection`
- `title: Translate selection`
- `contexts: ["selection"]`

## On click

1. The selected text is in `info.selectionText`.
2. Detect the source language.
3. Translate into the target language. Preserve meaning over literal word order. If the source is already in the target language, reply with "Already in English."
4. `notification_show`: title = "Translation (<source> → <target>)", message = the translation (truncated to 300 chars).
5. `clipboard_write` the full translation so the user can paste it wherever they need.

## Constraints
- Don't add commentary or explanation. The translation is the whole output.
- If the selection is over 1000 characters, translate anyway but warn in the notification title: "Translation (truncated)".

## Required permissions
`contextMenus`, `notifications`, `clipboardWrite`, `offscreen`.
