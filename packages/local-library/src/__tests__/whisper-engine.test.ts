/**
 * WhisperCppLocalEngine tests (P4-TRANSCRIBE row 3b): the REAL local
 * transcription-engine adapter, driven entirely through the INJECTED spawn
 * seam — no real process is ever spawned here (the default spawn impl is
 * the only real-process path, exercised on the user's machine, not in CI).
 *
 * Honest states pinned:
 * - discovery facts: override (absolute + bare name + stale fall-through),
 *   PATH priority order, standard locations with HOME templating, honest
 *   null when nothing exists;
 * - engine-absent => typed engine-unavailable with the recovery hint —
 *   surfaced, never hidden, never a silent empty result;
 * - boundary cancellation => typed cancelled, binary NEVER spawned;
 * - mid-run cancellation => the child is KILLED, the run rejects typed
 *   cancelled (both our kill and an external SIGKILL map to cancelled);
 * - non-zero exit / spawn error => typed engine-failed with the binary's
 *   own stderr surfaced (first line);
 * - segments parsed ONLY from the binary's own JSON-lines stdout — noise
 *   and malformed lines skipped, never fabricated; empty = honest no-speech;
 * - lineage read from the binary's own output ONLY: version/model/language
 *   banners parsed, absent when the binary printed nothing — never guessed;
 * - progress fires per parsed segment with NO totalSegments (a streaming
 *   run cannot honestly know it up front).
 *
 * HERMETIC: injected env + injected existence probe + canned children; no
 * network, no wall clock, no filesystem writes, no real subprocess.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranscriptionProgress } from "webflix-contracts";
import {
  discoverWhisperBinary,
  WHISPER_BINARY_NAMES,
  WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR,
  WHISPER_CPP_LOCAL_ENGINE_ID,
  WHISPER_CPP_LOCAL_ENGINE_VERSION,
  WHISPER_CPP_RECOVERY_HINT,
  WhisperCppLocalEngine,
} from "../index";
import type { EngineChildProcess, EngineChildStreams, SpawnEngineBinary } from "../index";

// ---------------------------------------------------------------------------
// Canned child (implements the seam's structural contract)
// ---------------------------------------------------------------------------

class FakeStreams implements EngineChildStreams {
  private readonly dataListeners: ((chunk: Buffer | string) => void)[] = [];
  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.dataListeners.push(listener);
  }
  emit(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }
}

class FakeChild implements EngineChildProcess {
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
  spawnImpl: SpawnEngineBinary;
} {
  const spawns: { binaryPath: string; args: readonly string[]; child: FakeChild }[] = [];
  const spawnImpl: SpawnEngineBinary = (binaryPath, args) => {
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
  const exists = over.exists ?? ((p: string) => p === "/x/bin/whisper-cli");
  const engine = new WhisperCppLocalEngine({
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

const HAPPY_STDERR = [
  "whisper.cpp: version = 1.7.4",
  "whisper_init_from_file_with_params_no_state: loading model from 'models/ggml-base.en-q5_1.bin'",
  "whisper_init_state: model language = en",
].join("\n");

describe("discoverWhisperBinary (the availability FACT)", () => {
  it("the WEBFLIX_WHISPER_BIN override wins as an absolute executable path", () => {
    const found = discoverWhisperBinary(
      { PATH: "/x/bin", HOME: "/home/u", WEBFLIX_WHISPER_BIN: "/opt/wh/whisper-cli" },
      (p) => p === "/opt/wh/whisper-cli",
    );
    expect(found).toBe("/opt/wh/whisper-cli");
  });

  it("a bare-name override resolves on PATH", () => {
    const found = discoverWhisperBinary(
      { PATH: "/x:/y", HOME: "/home/u", WEBFLIX_WHISPER_BIN: "whisper-cli" },
      (p) => p === "/y/whisper-cli",
    );
    expect(found).toBe("/y/whisper-cli");
  });

  it("a stale override falls through to the standard search (the machine's real fact)", () => {
    const found = discoverWhisperBinary(
      { PATH: "/x", HOME: "/home/u", WEBFLIX_WHISPER_BIN: "/gone/whisper-cli" },
      (p) => p === "/x/main",
    );
    expect(found).toBe("/x/main");
  });

  it("PATH lookup honours the candidate-name priority order (whisper-cli before main)", () => {
    expect(WHISPER_BINARY_NAMES[0]).toBe("whisper-cli");
    const found = discoverWhisperBinary(
      { PATH: "/x", HOME: "/home/u" },
      (p) => p === "/x/main" || p === "/x/whisper.cpp",
    );
    expect(found).toBe("/x/main");
    const first = discoverWhisperBinary(
      { PATH: "/x", HOME: "/home/u" },
      (p) => p === "/x/main" || p === "/x/whisper-cli",
    );
    expect(first).toBe("/x/whisper-cli");
  });

  it("standard locations are HOME-templated and searched after PATH", () => {
    const found = discoverWhisperBinary(
      { PATH: "", HOME: "/home/u" },
      (p) => p === "/home/u/.local/bin/whisper-cli",
    );
    expect(found).toBe("/home/u/.local/bin/whisper-cli");
  });

  it("nothing discoverable => honest null, never a guess", () => {
    expect(discoverWhisperBinary({ PATH: "", HOME: "/home/u" }, () => false)).toBeNull();
  });
});

describe("WhisperCppLocalEngine (the REAL adapter, canned-child seam)", () => {
  // -------------------------------------------------------------------------
  // Identity + availability
  // -------------------------------------------------------------------------
  it("exposes the adapter identity (OUR code's, always known) and honest lineage absence", () => {
    const { engine } = makeEngine();
    expect(engine.descriptor.id).toBe(WHISPER_CPP_LOCAL_ENGINE_ID);
    expect(engine.descriptor.version).toBe(WHISPER_CPP_LOCAL_ENGINE_VERSION);
    expect(engine.descriptor.label).toContain("whisper.cpp");
    expect(engine.descriptor.licenseNote).toContain("MIT");
    // The DESCRIPTOR never claims engine/model lineage — only a run can.
    expect(WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR.engineVersion).toBeUndefined();
    expect(WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR.modelLineage).toBeUndefined();
  });

  it("availability() states the fact with the recovery hint, without running anything", () => {
    const { engine } = makeEngine();
    expect(engine.availability()).toEqual({
      available: true,
      binaryPath: "/x/bin/whisper-cli",
      recoveryHint: WHISPER_CPP_RECOVERY_HINT,
    });
    const absent = new WhisperCppLocalEngine({
      processEnv: { PATH: "", HOME: "/home/u" },
      existsOnDisk: () => false,
      spawnImpl: makeSpawnSeam().spawnImpl,
    });
    expect(absent.availability()).toEqual({
      available: false,
      binaryPath: null,
      recoveryHint: WHISPER_CPP_RECOVERY_HINT,
    });
  });

  it("engine-absent transcribe => typed engine-unavailable WITH the recovery hint — surfaced, never a silent empty result", async () => {
    const engine = new WhisperCppLocalEngine({
      processEnv: { PATH: "", HOME: "/home/u" },
      existsOnDisk: () => false,
      spawnImpl: makeSpawnSeam().spawnImpl,
    });
    const err = await expectWebFlixErrorAsync(
      () => engine.transcribe({ mediaPath: "/media/a.mkv" }),
      ErrorCode.IntelligenceEngineUnavailable,
    );
    expect(err.context).toMatchObject({ recoveryHint: WHISPER_CPP_RECOVERY_HINT });
    expect(err.reason).toContain(WHISPER_CPP_RECOVERY_HINT);
    expect(WHISPER_CPP_RECOVERY_HINT).toBe("install whisper.cpp and set WEBFLIX_WHISPER_BIN");
  });

  // -------------------------------------------------------------------------
  // Happy path + lineage honesty
  // -------------------------------------------------------------------------
  it("parses segments from the binary's own JSON-lines stdout; version/model/language ONLY from its banners", async () => {
    const { engine, spawns } = makeEngine();
    const progress: TranscriptionProgress[] = [];
    const pending = engine.transcribe(
      { mediaPath: "/media/a.mkv", language: "en" },
      { onProgress: (p) => progress.push(p) },
    );
    const child = spawns[0]?.child;
    expect(child).toBeDefined();
    child?.emitStderr(`${HAPPY_STDERR}\n`);
    child?.emitStdout('{"startMs":0,"endMs":1500,"text":"hello"}\n');
    child?.emitStdout("system_info: n_threads = 4 / AVX = 1\n"); // noise, not JSON
    child?.emitStdout('{"startMs":1500,"endMs":3000,"text":"world"}\n');
    child?.emitClose(0, null);

    const result = await pending;
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 1500, text: "hello" },
      { startMs: 1500, endMs: 3000, text: "world" },
    ]);
    expect(result.engineVersion).toBe("1.7.4");
    expect(result.modelLineage).toBe("models/ggml-base.en-q5_1.bin");
    expect(result.language).toBe("en");
    // Progress per parsed segment, NO totalSegments (a streaming run cannot
    // honestly know it up front).
    expect(progress).toEqual([
      { completedSegments: 1, lastEndMs: 1500 },
      { completedSegments: 2, lastEndMs: 3000 },
    ]);
    // The binary ran with the media path UNTOUCHED + the language hint.
    expect(spawns[0]?.binaryPath).toBe("/x/bin/whisper-cli");
    expect(spawns[0]?.args).toEqual(["/media/a.mkv", "--print-json-lines", "-l", "en"]);
  });

  it("a silent binary yields honest absence: no version, no model lineage, no language", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitStdout('{"startMs":0,"endMs":1200,"text":"quiet"}\n');
    spawns[0]?.child.emitClose(0, null);
    const result = await pending;
    expect(result.segments).toHaveLength(1);
    expect(result.engineVersion).toBeUndefined();
    expect(result.modelLineage).toBeUndefined();
    expect(result.language).toBeUndefined();
    // No language hint => no -l arg.
    expect(spawns[0]?.args).toEqual(["/media/a.mkv", "--print-json-lines"]);
  });

  it("malformed JSON-lines are noise, skipped — never fabricated into segments", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    const child = spawns[0]?.child;
    child?.emitStdout("not json at all\n");
    child?.emitStdout("[1,2,3]\n"); // JSON, but not an object
    child?.emitStdout('{"startMs":0,"endMs":900}\n'); // object, but no text
    child?.emitStdout('{"startMs":2000,"endMs":1500,"text":"backwards"}\n'); // endMs < startMs
    child?.emitStdout('{"startMs":0,"endMs":500,"text":"real"}\n'); // the one valid line
    child?.emitClose(0, null);
    const result = await pending;
    expect(result.segments).toEqual([{ startMs: 0, endMs: 500, text: "real" }]);
  });

  it("empty stdout is the honest no-speech result: empty segments, no error", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitClose(0, null);
    const result = await pending;
    expect(result.segments).toEqual([]);
  });

  it("deterministic: the same canned binary output => the same result, byte for byte", async () => {
    const { engine, spawns } = makeEngine();
    const first = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitStderr(`${HAPPY_STDERR}\n`);
    spawns[0]?.child.emitStdout('{"startMs":0,"endMs":1500,"text":"hello"}\n');
    spawns[0]?.child.emitClose(0, null);
    const a = await first;

    const second = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[1]?.child.emitStderr(`${HAPPY_STDERR}\n`);
    spawns[1]?.child.emitStdout('{"startMs":0,"endMs":1500,"text":"hello"}\n');
    spawns[1]?.child.emitClose(0, null);
    const b = await second;

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Float ms values are coerced to integers deterministically.
    const third = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[2]?.child.emitStdout('{"startMs":0.4,"endMs":1500.7,"text":"rounded"}\n');
    spawns[2]?.child.emitClose(0, null);
    expect((await third).segments).toEqual([{ startMs: 0, endMs: 1501, text: "rounded" }]);
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------
  it("boundary cancellation: an aborted signal rejects typed-cancelled and NEVER spawns the binary", async () => {
    const { engine, spawns } = makeEngine();
    const controller = new AbortController();
    controller.abort();
    const err = await expectWebFlixErrorAsync(
      () => engine.transcribe({ mediaPath: "/media/a.mkv" }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.context).toMatchObject({ phase: "engine-run" });
    expect(spawns).toHaveLength(0);
  });

  it("mid-run cancellation: the abort KILLS the child and rejects typed-cancelled", async () => {
    const { engine, spawns } = makeEngine();
    const controller = new AbortController();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" }, { signal: controller.signal });
    const child = spawns[0]?.child;
    expect(child).toBeDefined();
    // Abort AFTER spawn: the listener kills the child…
    controller.abort();
    expect(child?.killSignals).toEqual(["SIGTERM"]);
    // …and the run maps the terminated child to the typed cancelled error.
    child?.emitStdout('{"startMs":0,"endMs":1500,"text":"partial"}\n');
    child?.emitClose(null, "SIGTERM");
    const err = await expectWebFlixErrorAsync(() => pending, ErrorCode.Cancelled);
    expect(err.reason).toContain("terminated mid-run");
  });

  it("an externally SIGKILLed binary also maps to typed cancelled (the run did not finish)", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitClose(null, "SIGKILL");
    await expectWebFlixErrorAsync(() => pending, ErrorCode.Cancelled);
  });

  // -------------------------------------------------------------------------
  // Failures — the binary's own stderr surfaced
  // -------------------------------------------------------------------------
  it("non-zero exit => typed engine-failed with the binary's own first stderr line", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitStderr(
      "whisper_init_from_file_with_params: loading model failed\nsecond line\n",
    );
    spawns[0]?.child.emitClose(1, null);
    const err = await expectWebFlixErrorAsync(() => pending, ErrorCode.IntelligenceEngineFailed);
    expect(err.reason).toContain("code 1");
    expect(err.reason).toContain("loading model failed");
    expect(err.reason).not.toContain("second line");
    expect(err.context).toMatchObject({ binaryPath: "/x/bin/whisper-cli", exitCode: 1 });
  });

  it("a spawn error (binary unexecutable) => typed engine-failed, no stdout parsing", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitError(new Error("spawn EACCES"));
    const err = await expectWebFlixErrorAsync(() => pending, ErrorCode.IntelligenceEngineFailed);
    expect(err.reason).toContain("could not be executed");
    expect(err.reason).toContain("EACCES");
  });

  it("non-zero exit with silent stderr stays honest: the code alone, no invented detail", async () => {
    const { engine, spawns } = makeEngine();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" });
    spawns[0]?.child.emitClose(127, null);
    const err = await expectWebFlixErrorAsync(() => pending, ErrorCode.IntelligenceEngineFailed);
    expect(err.reason).toBe("the whisper binary exited with code 127");
  });
});
