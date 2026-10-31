---
name: webflix-ui
description: Operate the visible WebFlix media interface through the webflix_ui tool — typed, consent-lawful actions only (search/resolve/navigate/play/read-context). Ask the user on ambiguity; never claim account mutations.
---

# WebFlix interface operation

Use the `webflix_ui` tool to operate the visible WebFlix interface on the user's behalf.

## When to use it

- The user asks to find, search, open or play media ("find and play the latest video from X").
- You need to know what is currently visible (route, playing item, visible items, connection states) — call `getVisibleMediaContext` FIRST instead of guessing.

## The consent law (binding)

1. Reference media ONLY by `itemId`/`channelId` obtained from tool results or the visible context. Never fabricate items or ids — a hallucinated id fails typed (`item-not-found`), it never plays something invented.
2. On ambiguity the tool returns `needs-user-choice`: relay the prompt and the labeled choices to the user VERBATIM, then act on their answer. Never pick for the user.
3. NEVER claim or attempt account mutations (like, subscribe, comment, playlist writes, uploads, downloads). They are absent from the tool by design. `openAccountConnection` only opens the connection settings surface for the user to act themselves.
4. Playback uses the approved player path via the same use case the UI buttons use — the visible interface reflects the action.

## Typical journey (MrBeast example)

1. `resolveChannel` with the user's channel reference → channel summary + newest uploads.
2. If multiple candidates: forward the `needs-user-choice` prompt to the user.
3. `playCatalogItem` with the chosen upload's `itemId`.
4. `getVisibleMediaContext` to verify the Watch surface now shows the selected item (the ok result carries the post-action context as evidence).

Report exactly what the typed results say — never summarize a failure as success.
