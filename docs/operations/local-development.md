# Local development and baseline verification

## Toolchain

The upstream baseline uses the repository-pinned versions in mise.toml and package.json. At the inspected baseline, upstream README specifies Node.js 24.14.0 and pnpm 10.33.2. Follow mise.toml if it changes.

## Safe initial verification

1. Confirm branch, HEAD, upstream remote and working tree before editing.
2. Run node scripts/check-workspace-freshness.mjs.
3. Review package.json and package-level scripts; do not assume every package has the same test command.
4. Use pnpm bootstrap for the documented default local bootstrap.
5. For development, use pnpm dev:desktop:test with a dedicated ZCODE_DATA_BASE_DIR or the WebFlix replacement setting locked by TL2. Do not accidentally start a production-configured mode.
6. Run pnpm lint, pnpm typecheck and pnpm fmt:check; run pnpm architecture:report and pnpm verify:pre-push.
7. Run the relevant existing package tests; record exact scripts, environment, exit status and totals. No test should depend on a real provider unless it is explicitly an authorized smoke test.
8. Build and launch the actual Electron app for GUI/E2E verification. Read the package script and target platform requirements before invoking packaging.

## Separate data roots

TL2 must settle a WebFlix-specific config/environment variable and prove its behavior with a test before release. Until then, developers must explicitly isolate test/dev profiles using the inherited supported data-root control. Never point development tests to an installed ZCode home or production account accidentally.

## Secrets and services

- Never commit .env files, API keys, cookies, provider sessions, private account exports or real personal media.
- Use fake/revocable development credentials only in local ignored configuration; never include values in work orders or logs.
- Do not start real provider write operations in a test suite.
- Use recorded/sanitized fixtures for deterministic connector contract tests.
- Live source verification is run separately, with authorization and a narrow test plan.

## Commands available at the reviewed baseline

- Bootstrap: pnpm bootstrap
- Desktop test mode: pnpm dev:desktop:test
- Web development (not the primary product): pnpm dev:web
- Lint: pnpm lint
- Typecheck: pnpm typecheck
- Format check: pnpm fmt:check
- Pre-push lint/architecture: pnpm verify:pre-push
- Architecture check/report/context: pnpm architecture:check, pnpm architecture:report and pnpm architecture:context <module-id>
- Desktop bundle options: pnpm bundle:desktop -- --help

Confirm these command names in current package.json before treating them as stable.
