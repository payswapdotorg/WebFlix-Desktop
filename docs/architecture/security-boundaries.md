# Security boundaries and privacy requirements

Status: Binding release gate for desktop and future remote services.

## Threat model

Treat provider webpages, embedded players, ads, media metadata, captions/subtitles, comments, downloaded filenames, torrent trackers/peers, extensions, model output and user-configured remote sources as untrusted. They may be malformed, malicious, instruction-like or designed to exfiltrate data. Untrusted content must never gain authority merely because it is being summarized or processed by an agent.

## Electron and renderer

- Keep renderer Node integration disabled; use context isolation and renderer sandboxing wherever supported by the inherited architecture.
- Expose minimal typed preload APIs. Never expose raw ipcRenderer, generic arbitrary-channel bridge, unrestricted filesystem, shell/process execution, credential stores or unrestricted host HTTP.
- Validate schemas at each IPC/service boundary. Bind privileged operations to a trusted WebContents/window/frame and expected origin. Reject unexpected frames, URLs and sender identities.
- Set restrictive Content Security Policy. Deny or explicitly review navigation, window opening, permission requests, downloads, custom protocols and external redirects.
- Renderer state is not authority for identity, paths, permissions, source capability, download rights or qualification.
- Remote websites run in isolated WebContents/sessions/partitions with no privileged WebFlix preload bridge. Do not share cookies/localStorage across unrelated providers.
- User-confirm destructive/external side effects such as deleting data, publishing, connecting accounts, downloading, opening untrusted executable content or syncing private data.
- Register custom schemes only with explicit allowed paths/MIME types and validated request parameters.

## Local API and media servers

- Bind local HTTP endpoints to loopback only unless a separately reviewed feature requires otherwise.
- Authenticate loopback endpoints that can read files, control downloads/playback or expose personal metadata. Use per-session random credentials, protect against DNS rebinding and validate Host/Origin where relevant.
- Never accept arbitrary paths or URLs without canonicalization, allowlisting and appropriate network/file protections.
- Protect against SSRF; disallow requests to loopback/private/link-local metadata services unless a narrowly scoped adapter needs them.
- Apply destination policy and protect against path traversal, symlink escapes and archive extraction escapes.
- Limit upload/download size, concurrent jobs, parser resource use and decompression ratios.

## Credentials and account isolation

- Use an OS-backed credential vault where available, behind a platform-neutral adapter; document any weaker fallback.
- Tokens/cookies never go into renderer localStorage, logs, fixtures, crash artifacts, URL query strings or Git.
- Keep provider credentials isolated by local profile/account and use least-privilege scopes.
- Never re-use the old web app's operator cookie as a desktop-user credential or backend identity.
- Implement connect, reauthorize, disconnect/revoke and token-expiry/error states. Do not claim logout revokes provider-side tokens unless invoked and verified.
- Scrub secrets from errors and telemetry; test redaction.

## Torrent/download security

- Torrent engines run behind a replaceable contract with bounded resource use and lifecycle/cancel controls.
- Desktop host owns peer networking and filesystem access; renderer does not invoke the engine arbitrarily.
- Make destination, download state, source/magnet metadata, bandwidth and cancellation visible to the user.
- Do not run downloaded content, installer files, scripts, subtitle payloads or archive contents automatically.
- Limit local streaming to an authenticated loopback endpoint tied to active user/job. Do not expose a peer proxy to the LAN by default.
- Support legally authorized files and sources. Do not implement DRM circumvention, stealth downloads or hidden persistence.

## Model and agent safety

- Retrieved webpages/captions/reviews/torrent names/ad copy are untrusted evidence, not system instructions.
- Tool permissions are explicit and least-privileged; read/search does not imply write/publish/download permission.
- Agent side effects route through the same application command/permission gate as the UI.
- Keep prompts, local paths, transcripts and library data out of telemetry unless explicitly and safely opted in. Logs have bounded retention and redact by default.

## Updates, branding and distribution

Before release, audit product name, bundle/package IDs, Windows AppUserModelId, file/protocol associations, data directory, updater feed, signing credentials, crash/analytics endpoints, telemetry identifiers and config origins. They must not accidentally use ZCode identity or production profile. Update transport, signature validation, rollback/failure behavior and artifact provenance must be tested.

## Required security tests

- Renderer cannot access Node/credentials/filesystem directly.
- Privileged IPC rejects invalid payloads, untrusted windows/frames and unapproved origins.
- Remote browser context cannot invoke privileged WebFlix APIs.
- Credential/log redaction tests.
- Path traversal and destination-policy tests.
- Loopback auth, host/origin and binding tests.
- Untrusted text cannot execute agent tools without authorization.
- Disconnect/deletion/failure states are honest.
- Packaged build is smoke-tested, not only dev mode.

Reference: https://www.electronjs.org/docs/latest/tutorial/security/
