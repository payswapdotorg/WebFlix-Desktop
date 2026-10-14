import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { atomicWritePrivateTextFile } from "@zcode/shared/node";
import { safeStorage as electronSafeStorage } from "electron";
import type { ProviderAccountRecord } from "webflix-contracts";
import type { OAuthAccountStore, StoredOAuthTokens } from "connectors";

/*
 * The production OS vault behind the OAuthAccountStore seam (P8-VAULT-1,
 * Phase-8 successor payload; isolation audit §1.5 "no production vault
 * exists" / §2.3 "the REAL vault … does not exist yet"; freeze §6.1/§6.2
 * token boundary = "main-process OS-vault adapter wrapping the inherited
 * credentialService shape").
 *
 * This is the FIRST non-test-double OAuthAccountStore implementation in the
 * tree. Design rulings (all binding, from the work order):
 *
 * - The frozen seam is implemented EXACTLY as declared
 *   (connectors/src/youtube/oauth.ts:110-118) via TYPE-ONLY imports — the
 *   shapes are re-used, never re-exported, never changed. The type-only
 *   imports are erased at compile time, so the desktop package gains NO
 *   runtime dependency on the connectors package (and desktop/package.json
 *   is outside this order's allowed paths; desktop main tsc is not a repo
 *   gate — the P8-RELEASE-DRIFT-1/P8-ISOLATION-WIRING-1 precedent).
 * - Encryption at rest: Electron safeStorage owns key management — the
 *   inherited credentialService's own named path
 *   (packages/services/src/credential/credentialService.ts:20-23: "后续可切换
 *   到 Electron safeStorage（钥匙串）托管密钥"). Every persisted payload
 *   (account records AND raw tokens) is safeStorage-encrypted BEFORE it
 *   touches disk; there is NO plaintext fallback, ever.
 * - Persistence path (cited choice): the WebFlix data root (~/.webflix /
 *   ~/.webflix-dev) via @zcode/shared/node atomicWritePrivateTextFile — the
 *   ONE shared-node helper consumed (credentialService.ts:78 uses the same
 *   primitive for its own writes). The inherited credentialService substrate
 *   itself is NOT used: it persists into the ZCode app-config credentials
 *   file shared with ZCode login credentials, which would mix WebFlix
 *   provider tokens into a ZCode artifact (freeze §6.1/§6.8 coexistence:
 *   WebFlix data lives under ~/.webflix, never under a ZCode root). The
 *   module is wrapped-by-citation, not forked, and not modified.
 * - Scoped keys: storage keys are namespaced per (provider,
 *   internalAccountId) — `webflix.oauth.<providerId>.<internalAccountId>.
 *   tokens|record`. Cross-account invisibility is BY CONSTRUCTION: keyed
 *   lookups only, no enumeration (the frozen interface has no list method
 *   and this implementation adds none); every persisted envelope carries a
 *   sha256 of its full scoped key and loads REFUSE (fail-loud) on mismatch,
 *   so a misfiled or tampered blob can never be read as another account's.
 * - Fail-closed unavailability: when safeStorage is unavailable (e.g. Linux
 *   without a keyring backend), saves REFUSE with a typed error and write
 *   NOTHING — never a plaintext fallback.
 * - Removes are idempotent (ENOENT-tolerant); saves are atomic
 *   (atomicWritePrivateTextFile: temp file + rename, mode 0o600); one
 *   writer (the desktop main process); no caching layer (every load reads
 *   the file).
 * - Desktop-native module (NOT one of the vendored webflix-shell copies in
 *   this directory — it consumes Electron main-process APIs by design).
 * Main-process ONLY: never import from renderer/preload/scheduler/host or
 * webflix-shell code (pinned by test).
 *
 * NO IPC/preload/renderer surface is invented here; mounting the vault into
 * the OAuth flow is the future mount order's call.
 */

/** Typed refusal code: safeStorage unavailable (fail-closed; no plaintext fallback). */
export const OS_VAULT_UNAVAILABLE_ERROR = "os_vault_unavailable";
/** Typed refusal code: unscoped access (empty provider/account id, or a foreign record). */
export const OS_VAULT_SCOPE_ERROR = "os_vault_scope_error";
/** Typed refusal code: the WebFlix data root cannot be resolved (identity env contract). */
export const OS_VAULT_DATA_ROOT_ERROR = "os_vault_data_root_error";
/** Typed failure code: an existing vault entry could not be read/decrypted (fail-loud). */
export const OS_VAULT_READ_ERROR = "os_vault_read_error";
/** Typed failure code: a vault mutation (persist/remove) failed. */
export const OS_VAULT_WRITE_ERROR = "os_vault_write_error";

/** Typed error for every vault refusal/failure; `code` is one of the constants above. */
export class OsVaultError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OsVaultError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The Electron safeStorage surface the vault consumes (mockable per the battery pattern). */
export interface OsVaultSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface OsVaultAccountStoreDependencies {
  /** Key-encryption backend; defaults to Electron's safeStorage (main process only). */
  readonly safeStorage?: OsVaultSafeStorage;
  /**
   * WebFlix data root that holds `oauth/…` (an ABSOLUTE path — the vault
   * refuses relative roots so writes can never depend on process.cwd()).
   * Defaults to the WEBFLIX_IDENTITY/WEBFLIX_DATA_ROOT env contract written
   * by the desktop main at startup (identity-env.ts) — see
   * {@link resolveWebFlixVaultDataRoot}.
   */
  readonly dataRoot?: string;
  /** Diagnostics sink; refusals/failures are typed errors regardless of logging. */
  readonly logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

/** On-disk envelope: versioned cipher tag + scoped-key hash + base64 ciphertext. */
interface OsVaultEnvelope {
  v: 1;
  cipher: "electron.safeStorage";
  /** sha256 hex (first 16 bytes) of the full scoped key — no plaintext ids on disk. */
  keyHash: string;
  /** base64 of the safeStorage-encrypted payload JSON. */
  data: string;
}

const OS_VAULT_CIPHER_TAG = "electron.safeStorage" as const;
const OS_VAULT_DIR_SEGMENT = "oauth";
const OS_VAULT_KEY_PREFIX = "webflix.oauth";
const OS_VAULT_HASH_BYTES = 16; // 128-bit truncation: collisions are beyond negligible

type OsVaultKeyKind = "tokens" | "record";

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sha256HexPrefix(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, OS_VAULT_HASH_BYTES * 2);
}

/** The logical scoped storage key: `webflix.oauth.<providerId>.<accountId>.<kind>`. */
function vaultScopeKey(
  providerId: string,
  internalAccountId: string,
  kind: OsVaultKeyKind,
): string {
  return `${OS_VAULT_KEY_PREFIX}.${providerId}.${internalAccountId}.${kind}`;
}

/** Path-safe provider segment (the browserDataManager partition discipline: provider plaintext, account hashed). */
function sanitizeProviderSegment(providerId: string): string {
  const sanitized = providerId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.slice(0, 48) || "x";
}

function vaultFilePath(
  dataRoot: string,
  providerId: string,
  internalAccountId: string,
  kind: OsVaultKeyKind,
): string {
  // The account id is hashed out of the file name (account identities never
  // appear in vault file names on disk — the resolveEmbeddedBrowserPartition
  // discipline); the plaintext scoped key lives ONLY inside the encrypted
  // envelope's hash.
  return join(
    dataRoot,
    OS_VAULT_DIR_SEGMENT,
    sanitizeProviderSegment(providerId),
    `${sha256HexPrefix(internalAccountId)}.${kind}`,
  );
}

function isStoredOAuthTokens(value: unknown): value is StoredOAuthTokens {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    (candidate.refreshToken === null || typeof candidate.refreshToken === "string") &&
    (candidate.expiresAtMs === null || typeof candidate.expiresAtMs === "number") &&
    typeof candidate.scope === "string" &&
    typeof candidate.tokenType === "string"
  );
}

/** Runtime field-set mirror of the frozen ProviderAccountRecordSchema (contracts account.ts) for read-back validation. */
function isProviderAccountRecord(value: unknown): value is ProviderAccountRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.providerId === "string" &&
    candidate.providerId.length > 0 &&
    typeof candidate.internalAccountId === "string" &&
    candidate.internalAccountId.length > 0 &&
    typeof candidate.displayName === "string" &&
    candidate.displayName.length > 0 &&
    Array.isArray(candidate.grantedScopes) &&
    candidate.grantedScopes.every((scope) => typeof scope === "string") &&
    (candidate.status === "connected" ||
      candidate.status === "expired" ||
      candidate.status === "revoked") &&
    typeof candidate.connectedAt === "string" &&
    (candidate.expiresAt === undefined || typeof candidate.expiresAt === "string")
  );
}

function isOsVaultEnvelope(value: unknown): value is OsVaultEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    candidate.cipher === OS_VAULT_CIPHER_TAG &&
    typeof candidate.keyHash === "string" &&
    candidate.keyHash.length > 0 &&
    typeof candidate.data === "string" &&
    candidate.data.length > 0
  );
}

/**
 * Default vault data root: the env contract the desktop main writes at
 * startup (WEBFLIX_IDENTITY=1 + WEBFLIX_DATA_ROOT, identity-env.ts /
 * desktopRuntimeEnv.ts) — mirroring services/paths.ts resolveDataRootSegment
 * semantics for the WebFlix branch: segment names join under the home dir,
 * absolute overrides win (test isolation). Fail-closed in BOTH directions:
 * the vault NEVER falls back to a ZCode root (freeze §6.1/§6.8 — when the
 * identity is off there is no honest default, so construction refuses), and
 * invalid spellings throw exactly like the services layer does.
 */
export function resolveWebFlixVaultDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  const raw = env.WEBFLIX_IDENTITY?.trim() ?? "";
  if (raw === "" || raw === "0") {
    throw new OsVaultError(
      OS_VAULT_DATA_ROOT_ERROR,
      "osVaultAccountStore: no WebFlix identity env contract (WEBFLIX_IDENTITY) is active — the vault refuses to guess a data root because it must never touch a ZCode root (freeze §6.1/§6.8); pass deps.dataRoot explicitly or boot under the WebFlix identity",
    );
  }
  if (raw !== "1") {
    throw new OsVaultError(
      OS_VAULT_DATA_ROOT_ERROR,
      `invalid WEBFLIX_IDENTITY=${raw}; expected 1 or 0 (fail-closed, mirroring services/paths.ts)`,
    );
  }
  const segment = env.WEBFLIX_DATA_ROOT?.trim();
  if (!segment) {
    throw new OsVaultError(
      OS_VAULT_DATA_ROOT_ERROR,
      "WEBFLIX_IDENTITY=1 requires WEBFLIX_DATA_ROOT (set by the desktop main at startup; fail-closed, mirroring services/paths.ts)",
    );
  }
  if (isAbsolute(segment)) {
    return segment;
  }
  return join(homeDir, segment);
}

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/**
 * Creates the production OS-vault-backed OAuthAccountStore for ONE provider
 * (audit §1.5's gap closed: the real store behind the frozen seam, not a
 * test double). Keyed lookups only — there is no list/enumeration method,
 * exactly like the frozen interface.
 */
export function createOsVaultAccountStore(
  providerId: string,
  deps: OsVaultAccountStoreDependencies = {},
): OAuthAccountStore {
  const boundProviderId = typeof providerId === "string" ? providerId.trim() : "";
  if (!boundProviderId) {
    throw new OsVaultError(
      OS_VAULT_SCOPE_ERROR,
      "osVaultAccountStore: a non-empty providerId is required — storage keys are namespaced per (provider, internalAccountId) and an unscoped store is refused by construction",
    );
  }
  const backend = deps.safeStorage ?? electronSafeStorage;
  const logger = deps.logger ?? noopLogger;
  const explicitRoot = typeof deps.dataRoot === "string" ? deps.dataRoot.trim() : "";
  if (deps.dataRoot !== undefined && explicitRoot === "") {
    throw new OsVaultError(
      OS_VAULT_DATA_ROOT_ERROR,
      "osVaultAccountStore: deps.dataRoot must be a non-empty absolute path (an empty root is never a valid vault location)",
    );
  }
  if (explicitRoot !== "" && !isAbsolute(explicitRoot)) {
    throw new OsVaultError(
      OS_VAULT_DATA_ROOT_ERROR,
      `osVaultAccountStore: deps.dataRoot must be absolute, got "${explicitRoot}" (relative roots would make vault writes depend on process.cwd(); fail-closed)`,
    );
  }
  // Omitted dataRoot → the env-contract default (typed refusal when the
  // WebFlix identity is not active — the vault never guesses a ZCode root).
  const dataRoot = explicitRoot !== "" ? explicitRoot : resolveWebFlixVaultDataRoot();

  function requireAccountId(internalAccountId: string): string {
    const id = typeof internalAccountId === "string" ? internalAccountId.trim() : "";
    if (!id) {
      throw new OsVaultError(
        OS_VAULT_SCOPE_ERROR,
        `osVaultAccountStore(${boundProviderId}): a non-empty internalAccountId is required (keyed lookups only — the adapter-seam discipline, providerDisconnectClear.ts)`,
      );
    }
    return id;
  }

  async function persistEncryptedEntry(
    internalAccountId: string,
    kind: OsVaultKeyKind,
    payloadJson: string,
  ): Promise<void> {
    if (!backend.isEncryptionAvailable()) {
      logger.warn(
        "[os-vault] refusing to persist OAuth material: Electron safeStorage is unavailable " +
          "(fail-closed; NEVER a plaintext fallback)",
        { providerId: boundProviderId, kind },
      );
      throw new OsVaultError(
        OS_VAULT_UNAVAILABLE_ERROR,
        `osVaultAccountStore(${boundProviderId}): Electron safeStorage is unavailable on this system ` +
          `(e.g. Linux without a keyring backend) — refusing to persist the ${kind} entry; no plaintext fallback exists by design`,
      );
    }
    const scopeKey = vaultScopeKey(boundProviderId, internalAccountId, kind);
    const filePath = vaultFilePath(dataRoot, boundProviderId, internalAccountId, kind);
    const envelope: OsVaultEnvelope = {
      v: 1,
      cipher: OS_VAULT_CIPHER_TAG,
      keyHash: sha256HexPrefix(scopeKey),
      data: backend.encryptString(payloadJson).toString("base64"),
    };
    try {
      await atomicWritePrivateTextFile(filePath, `${JSON.stringify(envelope)}\n`);
    } catch (error) {
      throw new OsVaultError(
        OS_VAULT_WRITE_ERROR,
        `osVaultAccountStore(${boundProviderId}): failed to persist the encrypted ${kind} entry at ${filePath}`,
        { cause: error },
      );
    }
    logger.info(`[os-vault] persisted encrypted ${kind} entry`, {
      providerId: boundProviderId,
      kind,
    });
  }

  async function readEncryptedEntry<T>(
    internalAccountId: string,
    kind: OsVaultKeyKind,
    isValidPayload: (value: unknown) => value is T,
  ): Promise<T | null> {
    const scopeKey = vaultScopeKey(boundProviderId, internalAccountId, kind);
    const filePath = vaultFilePath(dataRoot, boundProviderId, internalAccountId, kind);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") {
        return null; // absent key → null (the frozen empty semantics)
      }
      throw new OsVaultError(
        OS_VAULT_READ_ERROR,
        `osVaultAccountStore(${boundProviderId}): failed to read the ${kind} entry at ${filePath}`,
        { cause: error },
      );
    }
    let envelope: OsVaultEnvelope;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isOsVaultEnvelope(parsed)) {
        throw new Error("envelope shape mismatch");
      }
      envelope = parsed;
    } catch (error) {
      logger.warn("[os-vault] refusing a malformed vault envelope (fail-loud)", {
        providerId: boundProviderId,
        kind,
        filePath,
      });
      throw new OsVaultError(
        OS_VAULT_READ_ERROR,
        `osVaultAccountStore(${boundProviderId}): the ${kind} entry at ${filePath} is not a valid vault envelope (corrupt or foreign file)`,
        { cause: error },
      );
    }
    if (envelope.keyHash !== sha256HexPrefix(scopeKey)) {
      logger.warn("[os-vault] refusing an envelope whose scoped key does not match the request", {
        providerId: boundProviderId,
        kind,
        filePath,
      });
      throw new OsVaultError(
        OS_VAULT_READ_ERROR,
        `osVaultAccountStore(${boundProviderId}): the ${kind} entry at ${filePath} was written under a different ` +
          "scoped key (misfiled or tampered blob) — cross-account reads are impossible by construction, refusing",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(backend.decryptString(Buffer.from(envelope.data, "base64")));
    } catch (error) {
      logger.warn(
        "[os-vault] decrypt failed for an existing entry (keychain key lost or blob foreign)",
        {
          providerId: boundProviderId,
          kind,
          filePath,
        },
      );
      throw new OsVaultError(
        OS_VAULT_READ_ERROR,
        `osVaultAccountStore(${boundProviderId}): failed to decrypt the ${kind} entry at ${filePath} ` +
          "(the OS keychain key may have been lost or the blob was not written by this backend)",
        { cause: error },
      );
    }
    if (!isValidPayload(payload)) {
      logger.warn("[os-vault] decrypted payload failed the shape check", {
        providerId: boundProviderId,
        kind,
        filePath,
      });
      throw new OsVaultError(
        OS_VAULT_READ_ERROR,
        `osVaultAccountStore(${boundProviderId}): the decrypted ${kind} payload at ${filePath} does not match the frozen shape`,
      );
    }
    return payload;
  }

  async function removeEntry(internalAccountId: string, kind: OsVaultKeyKind): Promise<void> {
    const filePath = vaultFilePath(dataRoot, boundProviderId, internalAccountId, kind);
    try {
      // force: ENOENT-tolerant → removing an absent key succeeds (idempotent).
      await rm(filePath, { force: true });
    } catch (error) {
      throw new OsVaultError(
        OS_VAULT_WRITE_ERROR,
        `osVaultAccountStore(${boundProviderId}): failed to remove the ${kind} entry at ${filePath}`,
        { cause: error },
      );
    }
    logger.info(`[os-vault] removed ${kind} entry (idempotent when absent)`, {
      providerId: boundProviderId,
      kind,
    });
  }

  return {
    async loadAccount(internalAccountId): Promise<ProviderAccountRecord | null> {
      const id = requireAccountId(internalAccountId);
      return await readEncryptedEntry(id, "record", isProviderAccountRecord);
    },
    async saveAccount(record): Promise<void> {
      if (!isProviderAccountRecord(record)) {
        throw new OsVaultError(
          OS_VAULT_SCOPE_ERROR,
          `osVaultAccountStore(${boundProviderId}): refusing to persist a malformed ProviderAccountRecord (the frozen contracts account.ts field set)`,
        );
      }
      if (record.providerId.trim() !== boundProviderId) {
        logger.warn(
          "[os-vault] refusing to persist another provider's record into this store's namespace",
          { boundProviderId, recordProviderId: record.providerId },
        );
        throw new OsVaultError(
          OS_VAULT_SCOPE_ERROR,
          `osVaultAccountStore(${boundProviderId}): refusing to persist a "${record.providerId}" record — ` +
            "storage keys are namespaced per (provider, internalAccountId) and cross-provider writes are refused by construction",
        );
      }
      // Keying trims the id exactly like every other method (the payload
      // itself is persisted verbatim); a host minting clean ids is unaffected.
      const internalAccountId = requireAccountId(record.internalAccountId);
      await persistEncryptedEntry(internalAccountId, "record", JSON.stringify(record));
    },
    async removeAccount(internalAccountId): Promise<void> {
      const id = requireAccountId(internalAccountId);
      await removeEntry(id, "record");
    },
    async loadTokens(internalAccountId): Promise<StoredOAuthTokens | null> {
      const id = requireAccountId(internalAccountId);
      return await readEncryptedEntry(id, "tokens", isStoredOAuthTokens);
    },
    async saveTokens(internalAccountId, tokens): Promise<void> {
      const id = requireAccountId(internalAccountId);
      if (!isStoredOAuthTokens(tokens)) {
        throw new OsVaultError(
          OS_VAULT_SCOPE_ERROR,
          `osVaultAccountStore(${boundProviderId}): refusing to persist malformed OAuth tokens (the frozen StoredOAuthTokens shape, connectors/src/youtube/oauth.ts:96-103)`,
        );
      }
      await persistEncryptedEntry(id, "tokens", JSON.stringify(tokens));
    },
    async removeTokens(internalAccountId): Promise<void> {
      const id = requireAccountId(internalAccountId);
      await removeEntry(id, "tokens");
    },
  };
}
