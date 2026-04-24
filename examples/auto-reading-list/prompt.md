# Auto Reading List

When the user closes an article tab they likely didn't finish reading, silently add it to Chrome's reading list. Turns "I'll read this later" into actually finding it later.

## How to judge "didn't finish"

The heuristic: the tab was an article, was open for at least 30 seconds, and the user never explicitly bookmarked or saved it.

Since we can't observe scroll position from here, we approximate:
- URL passed a heuristic for "article" (path has `/blog/`, `/post/`, `/article/`, `/p/`, or host is in a known article-host list).
- The tab was open at least 30 s (track via `storage_set` on `tabs.onCreated`/`tabs.onUpdated`, compare on close).

## On each run

Events to watch:

1. `tabs.onUpdated` with `status: complete` on an article URL → record `{tabId, url, title, seenAt: now}` in `storage_set` under key `watching:<tabId>`.
2. `tabs.onRemoved` → look up `watching:<tabId>`. If found and `now - seenAt > 30_000`:
   - Call `reading_list_query` to check if URL is already there. If so, skip.
   - Call `reading_list_add` with the URL and title.
3. Clear the `watching:<tabId>` key after handling.

## Constraints
- No notifications. Silent is the feature.
- Never add login pages, chrome://, or file:// URLs.
- Hard cap: no more than 20 additions per day. Track via a daily counter in storage.

## Required permissions
`tabs`, `readingList`.
