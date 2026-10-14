import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccountRecord } from "webflix-contracts";
import type { OAuthAccountStore, StoredOAuthTokens } from "connectors";
import {
  createOsVaultAccountStore,
  OS_VAULT_DATA_ROOT_ERROR,
  OS_VAULT_READ_ERROR,
  OS_VAULT_SCOPE_ERROR,
  OS_VAULT_UNAVAILABLE_ERROR,
  resolveWebFlixVaultDataRoot,
} from "./osVaultAccountStore.js";

/*
 * P8-VAULT-1 — the production OS vault pins (audit §1.5's gap closed).
 * Fixture-tested only: safeStorage is MOCKED (the desktop battery's electron
 * mock pattern — autoUpdater.test.ts / providerDisconnectClear.test.ts) and
 * persistence lands in per-test temp dirs. Real keychain/platform behavior
 * is the packaged tier, honestly named (audit §4.3 precedent).
 *
 * The mock safeStorage actually TRANSFORMS (base64 with a prefix): anything
 * that skipped encryption would leak plaintext into the file bytes and fail
 * the encrypted-at-rest pins; anything not written by the mock fails
 * decryption (the decrypt-error pin).
 *
 * The vault module is imported statically — it holds no module-scope mutable
 * state (the factory closes over its deps), so no vi.resetModules dance is
 * needed; the electron mock is hoisted above the import as usual.
 */

const safeStorageState = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.available,
    encryptString: (plainText: string) =>
      Buffer.from(`mock-safe:${Buffer.from(plainText, "utf8").toString("base64")}`),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("mock-safe:")) {
        throw new Error("mock keychain could not decrypt the buffer");
      }
      return Buffer.from(text.slice("mock-safe:".length), "base64").toString("utf8");
    },
  },
}));

function testTokens(overrides: Partial<StoredOAuthTokens> = {}): StoredOAuthTokens {
  return {
    accessToken: "ya29.a0ARrdaM-SECRET-ACCESS-TOKEN-material-kZ9f3",
    refreshToken: "1//0gSECRET-REFRESH-TOKEN-material",
    expiresAtMs: 1_767_225_600_000,
    scope: "youtube.readonly",
    tokenType: "Bearer",
    ...overrides,
  };
}

function testRecord(internalAccountId: string, providerId = "youtube"): ProviderAccountRecord {
  return {
    providerId,
    internalAccountId,
    displayName: "Local Test Channel",
    grantedScopes: ["youtube.readonly"],
    status: "connected",
    connectedAt: "2026-10-14T00:00:00.000Z",
  };
}

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of ["WEBFLIX_IDENTITY", "WEBFLIX_DATA_ROOT"]) {
    SAVED_ENV[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

let dataRoot: string;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

function makeStore(providerId = "youtube"): OAuthAccountStore {
  return createOsVaultAccountStore(providerId, { dataRoot, logger });
}

async function vaultFiles(providerId = "youtube"): Promise<string[]> {
  const dir = join(dataRoot, "oauth", providerId);
  try {
    return (await readdir(dir)).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** Resolves the vault file for (provider, account, kind) without re-deriving hashes by hand. */
async function vaultFileFor(kind: "tokens" | "record"): Promise<string> {
  const files = await vaultFiles();
  const match = files.find((file) => file.endsWith(`.${kind}`));
  if (!match) throw new Error(`no .${kind} file under the vault dir: ${files.join(", ")}`);
  return match;
}

/**
 * Captures a refusal from a call that may THROW SYNCHRONOUSLY (factory /
 * resolver construction refusals) or REJECT asynchronously — both must land in
 * the assertion as the typed error, never as an escaping exception.
 */
async function captureRefusal(call: () => unknown): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    return error;
  }
}

beforeEach(async () => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
  safeStorageState.available = true;
  dataRoot = await mkdtemp(join(tmpdir(), "wfx-os-vault-"));
  logger = { info: vi.fn(), warn: vi.fn() };
});

afterEach(async () => {
  restoreEnv();
  await rm(dataRoot, { recursive: true, force: true });
});

describe("ruling 1 — the frozen OAuthAccountStore shape, implemented exactly", () => {
  it("exposes EXACTLY the six frozen methods and nothing else (no list/enumeration surface)", () => {
    const store = makeStore();
    expect(Object.keys(store).sort()).toEqual([
      "loadAccount",
      "loadTokens",
      "removeAccount",
      "removeTokens",
      "saveAccount",
      "saveTokens",
    ]);
    for (const method of Object.values(store)) {
      expect(typeof method).toBe("function");
    }
  }, 30_000);

  it("happy path: saveAccount + saveTokens persist and loadAccount + loadTokens round-trip exactly", async () => {
    const store = makeStore();
    const record = testRecord("local-user-1");
    const tokens = testTokens();
    await store.saveAccount(record);
    await store.saveTokens("local-user-1", tokens);

    expect(await store.loadAccount("local-user-1")).toEqual(record);
    expect(await store.loadTokens("local-user-1")).toEqual(tokens);
  }, 30_000);
});

describe("rulings 2 + 4 — encrypted at rest (safeStorage key management)", () => {
  it("the persisted bytes NEVER contain plaintext token material (raw accessToken/refreshToken absent)", async () => {
    const store = makeStore();
    const tokens = testTokens();
    await store.saveAccount(testRecord("local-user-1"));
    await store.saveTokens("local-user-1", tokens);

    for (const file of await vaultFiles()) {
      const content = await readFile(file, "utf-8");
      // No plaintext token VALUES anywhere on disk…
      expect(content).not.toContain(tokens.accessToken);
      expect(content).not.toContain(tokens.refreshToken ?? "<null-refresh-token>");
      // …and no plaintext payload FIELD NAMES either — the whole payload
      // JSON is inside the ciphertext, not just its values.
      expect(content).not.toContain("accessToken");
      expect(content).not.toContain("refreshToken");
      // The envelope really is the safeStorage-ciphered form.
      expect(content).toContain('"electron.safeStorage"');
    }
  }, 30_000);

  it("persisted files are owner-only (0o600) — the atomicWritePrivateTextFile substrate", async () => {
    const store = makeStore();
    await store.saveTokens("local-user-1", testTokens());
    if (process.platform === "win32") return; // POSIX mode bits do not apply
    for (const file of await vaultFiles()) {
      expect((await stat(file)).mode & 0o077).toBe(0);
    }
  }, 30_000);

  it("unavailable safeStorage: saveTokens → typed refusal, NO file written, logged; loadTokens → null", async () => {
    safeStorageState.available = false;
    const store = makeStore();
    const refusal = await store.saveTokens("local-user-1", testTokens()).catch((error) => error);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.code).toBe(OS_VAULT_UNAVAILABLE_ERROR);
    expect(refusal.message).toContain("no plaintext fallback");

    // Fail closed: nothing was persisted, so a later load sees null.
    expect(await vaultFiles()).toEqual([]);
    expect(await store.loadTokens("local-user-1")).toBeNull();
    // And the refusal was logged (fail closed, logged).
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("refusing to persist OAuth material"),
      expect.objectContaining({ providerId: "youtube", kind: "tokens" }),
    );
  }, 30_000);

  it("unavailable safeStorage: saveAccount refuses too (records are encrypted at rest exactly like tokens)", async () => {
    safeStorageState.available = false;
    const store = makeStore();
    const refusal = await store.saveAccount(testRecord("local-user-1")).catch((error) => error);
    expect(refusal.code).toBe(OS_VAULT_UNAVAILABLE_ERROR);
    expect(await vaultFiles()).toEqual([]);
    expect(await store.loadAccount("local-user-1")).toBeNull();
  }, 30_000);
});

describe("ruling 3 — scoped keys; cross-account/cross-provider invisibility by construction", () => {
  it("two accounts on ONE provider coexist; each keyed lookup sees only its own data", async () => {
    const store = makeStore();
    await store.saveAccount(testRecord("local-user-1"));
    await store.saveTokens("local-user-1", testTokens());
    await store.saveAccount(testRecord("local-user-2"));
    await store.saveTokens(
      "local-user-2",
      testTokens({ accessToken: "ya29.SECOND-ACCOUNT-token" }),
    );

    expect((await store.loadTokens("local-user-1"))?.accessToken).toBe(
      "ya29.a0ARrdaM-SECRET-ACCESS-TOKEN-material-kZ9f3",
    );
    expect((await store.loadTokens("local-user-2"))?.accessToken).toBe("ya29.SECOND-ACCOUNT-token");

    // Removing one account leaves the other fully intact.
    await store.removeAccount("local-user-1");
    await store.removeTokens("local-user-1");
    expect(await store.loadAccount("local-user-1")).toBeNull();
    expect(await store.loadTokens("local-user-1")).toBeNull();
    expect(await store.loadAccount("local-user-2")).toEqual(testRecord("local-user-2"));
    expect((await store.loadTokens("local-user-2"))?.accessToken).toBe("ya29.SECOND-ACCOUNT-token");
  }, 30_000);

  it("the store for provider P never sees another provider's keys (same data root, same account id)", async () => {
    const youtubeStore = makeStore("youtube");
    const twitchStore = makeStore("twitch");
    await twitchStore.saveAccount(testRecord("local-user-1", "twitch"));
    await twitchStore.saveTokens("local-user-1", testTokens());

    // Keyed lookups through the youtube store address only the youtube
    // namespace — the twitch entries are invisible in BOTH kinds.
    expect(await youtubeStore.loadAccount("local-user-1")).toBeNull();
    expect(await youtubeStore.loadTokens("local-user-1")).toBeNull();
    // And the reverse.
    expect(await twitchStore.loadAccount("local-user-1")).toEqual(
      testRecord("local-user-1", "twitch"),
    );
    expect((await twitchStore.loadTokens("local-user-1"))?.tokenType).toBe("Bearer");
  }, 30_000);

  it("saveAccount REFUSES a record from another provider (typed, no file written)", async () => {
    const store = makeStore("youtube");
    const refusal = await store
      .saveAccount(testRecord("local-user-1", "twitch"))
      .catch((error) => error);
    expect(refusal.code).toBe(OS_VAULT_SCOPE_ERROR);
    expect(refusal.message).toContain("cross-provider writes are refused");
    expect(await vaultFiles()).toEqual([]);
  }, 30_000);

  it("a misfiled/tampered envelope is REFUSED, never read as another account (the keyHash anchor)", async () => {
    const store = makeStore();
    await store.saveTokens("local-user-1", testTokens());

    // Simulate a misfiled blob: account local-user-2's file path now holds
    // local-user-1's ciphertext (the account hash segment was swapped).
    const sourceFile = await vaultFileFor("tokens");
    const { createHash } = await import("node:crypto");
    const forgedPath = join(
      dataRoot,
      "oauth",
      "youtube",
      `${createHash("sha256").update("local-user-2", "utf8").digest("hex").slice(0, 32)}.tokens`,
    );
    await writeFile(forgedPath, await readFile(sourceFile, "utf-8"), "utf-8");

    const refusal = await store.loadTokens("local-user-2").catch((error) => error);
    expect(refusal.code).toBe(OS_VAULT_READ_ERROR);
    expect(refusal.message).toContain("different scoped key");
    // local-user-1's own entry still round-trips.
    expect(await store.loadTokens("local-user-1")).toEqual(testTokens());
  }, 30_000);

  it("corrupt envelope bytes and undecryptable blobs fail LOUD (typed read errors, never null)", async () => {
    const store = makeStore();
    await store.saveTokens("local-user-1", testTokens());
    const file = await vaultFileFor("tokens");

    // Garbage bytes.
    await writeFile(file, "not json at all\n", "utf-8");
    const corrupt = await store.loadTokens("local-user-1").catch((error) => error);
    expect(corrupt.code).toBe(OS_VAULT_READ_ERROR);
    expect(corrupt.message).toContain("not a valid vault envelope");

    // A valid envelope whose ciphertext was not written by this backend
    // (simulates a lost keychain key): decrypt fails → typed read error.
    await store.saveTokens("local-user-1", testTokens()); // restore a good file
    const envelope = JSON.parse(await readFile(file, "utf-8")) as { data: string };
    await writeFile(
      file,
      `${JSON.stringify({ ...envelope, data: Buffer.from("foreign ciphertext").toString("base64") })}\n`,
      "utf-8",
    );
    const undecryptable = await store.loadTokens("local-user-1").catch((error) => error);
    expect(undecryptable.code).toBe(OS_VAULT_READ_ERROR);
    expect(undecryptable.message).toContain("failed to decrypt");
  }, 30_000);

  it("empty/whitespace account ids are typed refusals on every id-keyed method; empty providerId at construction too", async () => {
    const store = makeStore();
    for (const badId of ["", "   "]) {
      for (const call of [
        () => store.loadAccount(badId),
        () => store.removeAccount(badId),
        () => store.loadTokens(badId),
        () => store.saveTokens(badId, testTokens()),
        () => store.removeTokens(badId),
      ]) {
        const refusal = await call().catch((error) => error);
        expect(refusal.code).toBe(OS_VAULT_SCOPE_ERROR);
      }
    }
    const malformed = await store
      .saveAccount({ ...testRecord("local-user-1"), internalAccountId: "" })
      .catch((error) => error);
    expect(malformed.code).toBe(OS_VAULT_SCOPE_ERROR);

    // Construction refusals throw SYNCHRONOUSLY (the factory is not async).
    const unscopedStore = await captureRefusal(() =>
      createOsVaultAccountStore("  ", { dataRoot, logger }),
    );
    expect(unscopedStore).toBeInstanceOf(Error);
    expect((unscopedStore as { code?: string }).code).toBe(OS_VAULT_SCOPE_ERROR);
  }, 30_000);
});

describe("ruling 5 — idempotent removes", () => {
  it("removeAccount/removeTokens succeed on ABSENT keys; double removes succeed; post-remove loads are null", async () => {
    const store = makeStore();
    // Absent keys: no throw, per the frozen seam's idempotency contract.
    await expect(store.removeAccount("never-saved")).resolves.toBeUndefined();
    await expect(store.removeTokens("never-saved")).resolves.toBeUndefined();

    await store.saveAccount(testRecord("local-user-1"));
    await store.saveTokens("local-user-1", testTokens());
    await store.removeTokens("local-user-1");
    await store.removeTokens("local-user-1"); // double remove
    await store.removeAccount("local-user-1");
    await store.removeAccount("local-user-1"); // double remove
    expect(await store.loadAccount("local-user-1")).toBeNull();
    expect(await store.loadTokens("local-user-1")).toBeNull();
    expect(await vaultFiles()).toEqual([]); // both entries really gone
  }, 30_000);
});

describe("ruling 2 (persistence path) — the WebFlix data root default", () => {
  it("construction without deps.dataRoot REFUSES when the identity env is off (never a ZCode root)", async () => {
    const refusal = await captureRefusal(() => createOsVaultAccountStore("youtube", { logger }));
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as { code?: string }).code).toBe(OS_VAULT_DATA_ROOT_ERROR);
    expect((refusal as Error).message).toContain("must never touch a ZCode root");
  }, 30_000);

  it("resolveWebFlixVaultDataRoot mirrors the services env contract: home-dir join, absolute override, fail-closed spellings", async () => {
    // Segment joins under the home dir (the packaged default is .webflix).
    expect(
      resolveWebFlixVaultDataRoot(
        { WEBFLIX_IDENTITY: "1", WEBFLIX_DATA_ROOT: ".webflix" },
        "/home/tester",
      ),
    ).toBe("/home/tester/.webflix");
    // Absolute overrides win (test isolation parity with services/paths.ts).
    expect(
      resolveWebFlixVaultDataRoot(
        { WEBFLIX_IDENTITY: "1", WEBFLIX_DATA_ROOT: "/tmp/wf-isolated-root" },
        "/home/tester",
      ),
    ).toBe("/tmp/wf-isolated-root");
    // Identity on but no root segment: typed refusal (fail-closed parity).
    const missingRoot = await captureRefusal(() =>
      resolveWebFlixVaultDataRoot({ WEBFLIX_IDENTITY: "1" }, "/home/tester"),
    );
    expect(missingRoot).toBeInstanceOf(Error);
    expect((missingRoot as { code?: string }).code).toBe(OS_VAULT_DATA_ROOT_ERROR);
    expect((missingRoot as Error).message).toContain("requires WEBFLIX_DATA_ROOT");
    // Invalid spelling: typed refusal, exactly like services/paths.ts.
    const invalid = await captureRefusal(() =>
      resolveWebFlixVaultDataRoot({ WEBFLIX_IDENTITY: "true" }, "/home/tester"),
    );
    expect(invalid).toBeInstanceOf(Error);
    expect((invalid as { code?: string }).code).toBe(OS_VAULT_DATA_ROOT_ERROR);
    expect((invalid as Error).message).toContain("invalid WEBFLIX_IDENTITY");
  }, 30_000);

  it("an absolute WEBFLIX_DATA_ROOT override is honored end-to-end by the default construction path", async () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = dataRoot; // the per-test temp root, absolute
    const store = createOsVaultAccountStore("youtube", { logger });
    await store.saveTokens("local-user-1", testTokens());
    expect(await store.loadTokens("local-user-1")).toEqual(testTokens());
    expect((await vaultFiles()).length).toBe(1); // written under the OVERRIDE root, not ~
  }, 30_000);
});

describe("ruling 7 — main-process-only boundary", () => {
  it("renderer/preload/scheduler/host and webflix-shell sources NEVER import the vault module", async () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    // packages/desktop/src/main/webflix/ → repo root is five levels up.
    const repoRootSegments = here.split("/").slice(0, -6);
    const repoRoot = repoRootSegments.join("/") || "/";
    const scanRoots = [
      join(repoRoot, "packages/desktop/src/renderer"),
      join(repoRoot, "packages/desktop/src/preload"),
      join(repoRoot, "packages/desktop/src/scheduler"),
      join(repoRoot, "packages/desktop/src/host"),
      join(repoRoot, "packages/webflix-shell/src"),
    ];
    const offenders: string[] = [];
    for (const root of scanRoots) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
        const file = join(entry.parentPath, entry.name);
        const source = await readFile(file, "utf-8");
        if (source.includes("osVaultAccountStore")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});
