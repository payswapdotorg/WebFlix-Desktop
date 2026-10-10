# Patch spec — WebFlix flavor for `packages/desktop/scripts/desktop-product-identity.mjs`

**Lane:** WebFlix-Desktop D2-LOCAL · Worker 2 · milestone 2/4
**Status:** SPEC ONLY — deliberately NOT applied in this environment (the desktop package's build tooling is not available here). The desktop maintainer applies this spec verbatim at integration time.
**Base:** the `d1-shell` branch base of `packages/desktop/scripts/desktop-product-identity.mjs` (snapshot recorded in §3).
**Normative references:** AUDIT-DESKTOP (this script is the centralized identity switch point) · freeze §6.1 (binding identity values) · mirror module `packages/webflix-shell/src/identity.ts` and its tests `packages/webflix-shell/src/identity.test.ts`.
**Lane commit:** `d1(identity): frozen WebFlix identity values + desktop-product-identity patch spec`

## 1. Why

AUDIT-DESKTOP designates `packages/desktop/scripts/desktop-product-identity.mjs` as the single switch point for every desktop identity surface (Electron `appId`, `productName`, protocol scheme, userData directory, Windows AUMID, Linux package name). The WebFlix flavor therefore has to be added here — never hardcoded in app code. The values are frozen by freeze §6.1 and mirrored in `packages/webflix-shell/src/identity.ts`; the vitest suite `identity.test.ts` pins them exactly and must keep passing (it is value-based and does not depend on this script being patched).

This patch also fixes the dev-AUMID defect flagged by AUDIT-DESKTOP: the ZCode flavor's dev AUMID reuses the production AUMID `cn.aminer.zcode`, so dev and prod share one Toast/notification identity. The fix is both corrected values and a runtime guard so the bug cannot come back.

## 2. Frozen values (freeze §6.1 — BINDING)

| Field | Frozen value | Source |
| --- | --- | --- |
| appId / production AUMID | `org.webflix.desktop` | freeze §6.1 |
| productName | `WebFlix` | freeze §6.1 |
| scheme | `webflix://` | freeze §6.1 |
| data root (production) | `~/.webflix` | freeze §6.1 |
| data root (development) | `~/.webflix-dev` | freeze §6.1 |
| dev AUMID | `org.webflix.desktop.dev` | freeze §6.1 |
| Linux package names | `webflix-desktop*` → `webflix-desktop`, `webflix-desktop-dev` | freeze §6.1 |
| env aliases | `ZCODE_*` kept during migration | freeze §6.1 |
| Forbidden on any WebFlix surface | appId/AUMID `cn.aminer.zcode`, scheme `zcode://`, data root `~/.zcode`, packages `zcode-desktop*` | freeze §6.1 coexistence + AUDIT-DESKTOP |

## 3. Base snapshot (as read at the d1-shell branch base)
