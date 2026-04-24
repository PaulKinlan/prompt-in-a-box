# summarize-on-navigate

Event-driven. Watches `webNavigation.onCompleted`; for any URL matching a pattern in the prompt, scrapes the page and writes a summary to OPFS.

- **Trigger:** `webNavigation.onCompleted` (queued)
- **Required permissions:** `tabs`, `scripting`, `webNavigation`
- **Writes:** `OPFS://summaries/YYYY-MM-DD/<slug>.md` + `OPFS://summaries/index-YYYY-MM-DD.md`
- **Side effects:** none user-visible; pure accumulation

To change the URL patterns, edit the "URL patterns to summarise" section of `prompt.md`. No code change needed.
