/**
 * ArgosClassLocalTranslationEngine tests (P4-TRANSLATE row 3): the REAL
 * local translation-engine adapter, driven entirely through the INJECTED
 * spawn seam — no real process is ever spawned here (the default spawn
 * impl is the only real-process path, exercised on the user's machine,
 * not in CI).
 *
 * Honest states pinned (the whisper-engine suite's shape):
 * - discovery facts: override (absolute + bare name + stale fall-through),
 *   PATH priority order, standard locations with HOME templating, honest
 *   null when nothing exists;
 * - engine-absent => typed translation-engine-unavailable with the
 *   recovery hint — surfaced, never hidden, never a silent empty result;
 * - boundary cancellation => typed cancelled, binary NEVER spawned;
 * - mid-run cancellation => the child is KILLED, the run rejects typed
 *   cancelled (both our kill and an external SIGKILL map to cancelled);
 * - non-zero exit / spawn error => typed translation-engine-failed with
 *   the binary's own stderr surfaced (first line);
 * - the translation IS the binary's own stdout (trailing whitespace
 *   trimmed); EMPTY stdout is a FAILED run, never an empty success;
 * - lineage read from the binary's own output ONLY: version banners
 *   parsed, absent when the binary printed nothing — never guessed;
 * - the run is one honest work unit (progress 1/1 after exit).
 *
 * HERMETIC: injected env + injected existence probe + canned children; no
 * network, no wall clock, no filesystem writes, no real subprocess.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranslationEngineProgress } from "webflix-contracts";
import {
  ARGOS_BINARY_NAMES,
  ARGOS_LOCAL_TRANSLATION_ENGINE_DESCRIPTOR,
  ARGOS_LOCAL_TRANSLATION_ENGINE_ID,
  ARGOS_LOCAL_TRANSLATION_ENGINE_VERSION,
  ARGOS_RECOVERY_HINT,
  ArgosClassLocalTranslationEngine,
  discoverArgosBinary,
} from "../index";
import type {
  ArgosEngineChildProcess,
  ArgosEngineChildStreams,
  ArgosSpawnEngineBinary,
} from "../index";

// ---------------------------------------------------------------------------
// Canned child (implements the seam's structural contract)
// ---------------------------------------------------------------------------

class FakeStreams implements ArgosEngineChildStreams {
  private readonly dataListeners: ((chunk: Buffer | string) => void)[] = [];
  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.dataListeners.push(listener);
  }
  emit(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }
}

class FakeChild implements ArgosEngineChildProcess {
  readonly pid = 4242;
  readonly stdout = new FakeStreams();
  readonly stderr = new FakeStreams();
  private readonly closeListeners: ((code: number | null, signal: string | null) => void)[] = [];
  private readonly errorListeners: ((err: Error) => void)[] = [];
  readonly killSignals: string[] = [];

  // A single broad method satisfies BOTH interface overloads: the event
  // union covers both literals, and a rest-never listener accepts every
  // concrete listener shape (arity and type) under strict contravariance.
  on(event: "error" | "close", listener: (...args: never[]) => void): void {
    if (event === "error") this.errorListeners.push(listener as (err: Error) => void);
    else this.closeListeners.push(listener as (code: number | null, signal: string | null) => void);
  }

  kill(signal = "SIGTERM"): void {
    this.killSignals.push(signal);
  }

  emitStdout(text: string): void {
    this.stdout.emit(text);
  }
  emitStderr(text: string): void {
    this.stderr.emit(text);
  }
  emitClose(code: number | null, signal: string | null): void {
    for (const listener of this.closeListeners) listener(code, signal);
  }
  emitError(err: Error): void {
    for (const listener of this.errorListeners) listener(err);
  }
}

/** Records every spawn and hands back a controllable fake child. */
function makeSpawnSeam(): {
  spawns: { binaryPath: string; args: readonly string[]; child: FakeChild }[];
  spawnImpl: ArgosSpawnEngineBinary;
} {
  const spawns: { binaryPath: string; args: readonly string[]; child: FakeChild }[] = [];
  const spawnImpl: ArgosSpawnEngineBinary = (binaryPath, args) => {
    const child = new FakeChild();
    spawns.push({ binaryPath, args, child });
    return child;
  };
  return { spawns, spawnImpl };
}

/** Engine with a discovered binary (pinned env + probe) and the canned seam. */
function makeEngine(over: { env?: Record<string, string>; exists?: (p: string) => boolean } = {}) {
  const seam = makeSpawnSeam();
  const env = { PATH: "/x/bin", HOME: "/home/u", ...over.env };
  const exists = over.exists ?? ((p: string) => p === "/x/bin/argos-translate");
  const engine = new ArgosClassLocalTranslationEngine({
    processEnv: env,
    existsOnDisk: exists,
    spawnImpl: seam.spawnImpl,
  });
  return { engine, spawns: seam.spawns };
}

async function expectWebFlixErrorAsync(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

const REQUEST = {
  text: "the deployment failed on staging",
  sourceLanguageTag: "en",
  targetLanguageTag: "es",
} as const;

describe("ArgosClassLocalTranslationEngine (hermetic — canned children only)", () => {
  // -------------------------------------------------------------------------
  // Discovery (pure function of env + probe)
  // -------------------------------------------------------------------------
  it("discovery: the absolute override wins as-is", () => {
    const found = discoverArgosBinary(
      { PATH: "/x/bin", HOME: "/home/u", WEBFLIX_ARGOS_BIN: "/opt/argos/bin/argos-translate" },
      (p) => p === "/opt/argos/bin/argos-translate",
    );
    expect(found).toBe("/opt/argos/bin/argos-translate");
  });

  it("discovery: a bare-name override resolves on PATH", () => {
    const found = discoverArgosBinary(
      { PATH: "/x/bin:/y/bin", HOME: "/home/u", WEBFLIX_ARGOS_BIN: "argos" },
      (p) => p === "/y/bin/argos",
    );
    expect(found).toBe("/y/bin/argos");
  });

  it("discovery: a STALE override falls through to the standard search (the machine's real fact)", () => {
    const found = discoverArgosBinary(
      { PATH: "/x/bin", HOME: "/home/u", WEBFLIX_ARGOS_BIN: "/gone/argos-translate" },
      (p) => p === "/home/u/.local/bin/argos-translate",
    );
    expect(found).toBe("/home/u/.local/bin/argos-translate");
  });

  it("discovery: PATH beats standard locations per candidate order", () => {
    const found = discoverArgosBinary({ PATH: "/x/bin:/y/bin", HOME: "/home/u" }, (p) =>
      ["/x/bin/argos-translate", "/y/bin/argos", "/home/u/.local/bin/argos-translate"].includes(p),
    );
    expect(found).toBe("/x/bin/argos-translate");
  });

  it("discovery: standard locations resolve ${HOME} templates; nothing found => honest null", () => {
    const found = discoverArgosBinary(
      { PATH: "", HOME: "/home/u" },
      (p) => p === "/home/u/bin/argos",
    );
    expect(found).toBe("/home/u/bin/argos");
    expect(discoverArgosBinary({ PATH: "", HOME: "/home/u" }, () => false)).toBeNull();
  });

  it("availability(): the honest fact + the recovery hint, without running anything", () => {
    const { engine } = makeEngine();
    expect(engine.availability()).toEqual({
      available: true,
      binaryPath: "/x/bin/argos-translate",
      recoveryHint: ARGOS_RECOVERY_HINT,
    });
    const absent = new ArgosClassLocalTranslationEngine({
      processEnv: { PATH: "", HOME: "/home/u" },
      existsOnDisk: () => false,
      spawnImpl: makeSpawnSeam().spawnImpl,
    });
    expect(absent.availability().available).toBe(false);
    expect(absent.availability().binaryPath).toBeNull();
    expect(absent.availability().recoveryHint).toContain("argos-translate");
  });

  // -------------------------------------------------------------------------
  // Honest absence
  // -------------------------------------------------------------------------
  it("engine-absent => the TYPED translation-engine-unavailable error with the recovery hint", async () => {
    const engine = new ArgosClassLocalTranslationEngine({
      processEnv: { PATH: "", HOME: "/home/u" },
      existsOnDisk: () => false,
      spawnImpl: makeSpawnSeam().spawnImpl,
    });
    const err = await expectWebFlixErrorAsync(
      () => engine.translate({ ...REQUEST }),
      ErrorCode.IntelligenceTranslationEngineUnavailable,
    );
    expect(err.reason).toContain(ARGOS_RECOVERY_HINT);
    expect(err.reason).toContain("no Argos-class binary found");
  });

  // -------------------------------------------------------------------------
  // The run shape + honest output
  // -------------------------------------------------------------------------
  it("happy path: the documented one-shot CLI args; stdout IS the translation (trailing newline trimmed)", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.binaryPath).toBe("/x/bin/argos-translate");
    expect(spawns[0]?.args).toEqual([
      "--source-lang",
      "en",
      "--target-lang",
      "es",
      "the deployment failed on staging",
    ]);
    spawns[0]?.child.emitStdout("el despliegue falló en staging\n");
    spawns[0]?.child.emitClose(0, null);
    const result = await run;
    expect(result.translatedText).toBe("el despliegue falló en staging");
    // Lineage honestly ABSENT: the binary printed no version banner.
    expect(result.engineVersion).toBeUndefined();
    expect(result.modelLineage).toBeUndefined();
  });

  it("EMPTY stdout is a FAILED run — never an empty translation success", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    spawns[0]?.child.emitStdout("\n  \n");
    spawns[0]?.child.emitStderr("model not installed");
    spawns[0]?.child.emitClose(0, null);
    const err = await expectWebFlixErrorAsync(
      () => run,
      ErrorCode.IntelligenceTranslationEngineFailed,
    );
    expect(err.reason).toContain("printed no translation");
    expect(err.reason).toContain("model not installed");
  });

  it("non-zero exit => typed engine-failed with the binary's own stderr first line", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    spawns[0]?.child.emitStderr("Traceback (most recent call last):\nValueError: bad lang\n");
    spawns[0]?.child.emitClose(2, null);
    const err = await expectWebFlixErrorAsync(
      () => run,
      ErrorCode.IntelligenceTranslationEngineFailed,
    );
    expect(err.reason).toContain("exited with code 2");
    expect(err.reason).toContain("Traceback (most recent call last):");
  });

  it("spawn error => typed engine-failed (the binary could not be executed)", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    spawns[0]?.child.emitError(new Error("ENOENT"));
    await expectWebFlixErrorAsync(() => run, ErrorCode.IntelligenceTranslationEngineFailed);
  });

  it("lineage: version banners parsed from the binary's OWN combined output only", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    spawns[0]?.child.emitStdout("argos-translate 1.9.6\nel despliegue falló en staging\n");
    spawns[0]?.child.emitStderr("loading translation model 'en→es'\n");
    spawns[0]?.child.emitClose(0, null);
    const result = await run;
    expect(result.engineVersion).toBe("1.9.6");
    expect(result.modelLineage).toBe("en→es");
  });

  it("lineage is CONSERVATIVE: non-banner output never fabricates a version", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    // A progress-ish line that merely contains digits after the name and
    // an unquoted model mention — NEITHER is a lineage fact.
    spawns[0]?.child.emitStdout("argos-translate loaded 2 models\nhola\n");
    spawns[0]?.child.emitStderr("loading model from unquoted path\n");
    spawns[0]?.child.emitClose(0, null);
    const result = await run;
    expect(result.engineVersion).toBeUndefined();
    expect(result.modelLineage).toBeUndefined();
  });

  it("the run is ONE honest work unit: progress 1/1 after exit", async () => {
    const { engine, spawns } = makeEngine();
    const seen: TranslationEngineProgress[] = [];
    const run = engine.translate({ ...REQUEST }, { onProgress: (p) => seen.push(p) });
    spawns[0]?.child.emitStdout("hola\n");
    spawns[0]?.child.emitClose(0, null);
    await run;
    expect(seen).toEqual([{ completedUnits: 1, totalUnits: 1 }]);
  });

  // -------------------------------------------------------------------------
  // Cancellation (both phases)
  // -------------------------------------------------------------------------
  it("boundary cancellation: a pre-aborted signal => typed cancelled, the binary is NEVER spawned", async () => {
    const { engine, spawns } = makeEngine();
    const controller = new AbortController();
    controller.abort();
    const err = await expectWebFlixErrorAsync(
      () => engine.translate({ ...REQUEST }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.reason).toContain("before the binary was spawned");
    expect(spawns).toHaveLength(0);
  });

  it("mid-run cancellation: the child is KILLED and the run rejects typed cancelled", async () => {
    const { engine, spawns } = makeEngine();
    const controller = new AbortController();
    const run = engine.translate({ ...REQUEST }, { signal: controller.signal });
    controller.abort();
    spawns[0]?.child.emitClose(null, "SIGTERM");
    const err = await expectWebFlixErrorAsync(() => run, ErrorCode.Cancelled);
    expect(err.reason).toContain("terminated mid-run");
    expect(spawns[0]?.child.killSignals).toEqual(["SIGTERM"]);
  });

  it("an EXTERNAL SIGKILL also maps to the honest cancelled outcome", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.translate({ ...REQUEST });
    spawns[0]?.child.emitClose(null, "SIGKILL");
    await expectWebFlixErrorAsync(() => run, ErrorCode.Cancelled);
  });

  // -------------------------------------------------------------------------
  // The adapter's own identity (always known — never guessed)
  // -------------------------------------------------------------------------
  it("the descriptor pins the adapter identity and the honest-absent lineage", () => {
    const { engine } = makeEngine();
    expect(engine.descriptor.id).toBe(ARGOS_LOCAL_TRANSLATION_ENGINE_ID);
    expect(engine.descriptor.version).toBe(ARGOS_LOCAL_TRANSLATION_ENGINE_VERSION);
    expect(engine.descriptor).toEqual(ARGOS_LOCAL_TRANSLATION_ENGINE_DESCRIPTOR);
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();
    expect(ARGOS_BINARY_NAMES).toEqual(["argos-translate", "argos"]);
  });
});
