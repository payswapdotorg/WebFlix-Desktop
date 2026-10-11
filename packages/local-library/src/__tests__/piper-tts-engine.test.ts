/**
 * PiperLocalTtsEngine tests (P4-TRANSLATE row 3): the REAL local TTS-engine
 * adapter, driven entirely through the INJECTED seams — spawn (with stdin),
 * existence probes, voice-directory listing, audio read-back, and the
 * output path — no real process, file, or network I/O ever happens here
 * (the defaults are the only real-I/O paths, exercised on the user's
 * machine, not in CI).
 *
 * Honest states pinned:
 * - ENGINE discovery facts: override (absolute + bare + stale
 *   fall-through), PATH, standard locations, honest null;
 * - VOICE discovery facts: the WEBFLIX_PIPER_VOICE override (stem = id),
 *   standard directories' *.onnx files (stem = id), dedupe (override
 *   wins), deterministic id-sorted order;
 * - engine-absent => typed tts-engine-unavailable + engine hint; unknown
 *   requested voice => typed tts-engine-unavailable + voice hint and the
 *   discovered set — both surfaced, never hidden;
 * - boundary cancellation => typed cancelled, binary NEVER spawned;
 * - mid-run cancellation => the child is KILLED, typed cancelled (an
 *   external SIGKILL maps to cancelled too);
 * - non-zero exit / spawn error / unreadable output / EMPTY audio =>
 *   typed tts-engine-failed (never an empty success);
 * - the run shape: --model <voice.onnx> --output_file <out.wav>, the text
 *   written ONCE to STDIN then closed (piper's documented echo|piper
 *   shape); audio read back from EXACTLY the output path;
 * - lineage read from the binary's own output ONLY (conservative —
 *   non-banner output never fabricates a version);
 * - the run is one honest work unit (progress 1/1 after exit).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TtsEngineProgress } from "webflix-contracts";
import {
  discoverPiperBinary,
  discoverPiperVoices,
  PIPER_BINARY_NAMES,
  PIPER_ENGINE_RECOVERY_HINT,
  PIPER_LOCAL_TTS_ENGINE_DESCRIPTOR,
  PIPER_LOCAL_TTS_ENGINE_ID,
  PIPER_LOCAL_TTS_ENGINE_VERSION,
  PIPER_VOICE_RECOVERY_HINT,
  PiperLocalTtsEngine,
} from "../index";
import type {
  PiperEngineChildProcess,
  PiperEngineChildStdin,
  PiperEngineChildStreams,
  PiperEngineProcessEnv,
  PiperLocalTtsEngineOptions,
  PiperSpawnEngineBinary,
} from "../index";

// ---------------------------------------------------------------------------
// Canned child (implements the seam's structural contract — stdin included)
// ---------------------------------------------------------------------------

class FakeStreams implements PiperEngineChildStreams {
  private readonly dataListeners: ((chunk: Buffer | string) => void)[] = [];
  on(_event: "data", listener: (chunk: Buffer | string) => void): void {
    this.dataListeners.push(listener);
  }
  emit(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }
}

class FakeStdin implements PiperEngineChildStdin {
  readonly written: string[] = [];
  private ended = false;
  write(chunk: string): void {
    if (this.ended) throw new Error("write after end");
    this.written.push(chunk);
  }
  end(): void {
    this.ended = true;
  }
}

class FakeChild implements PiperEngineChildProcess {
  readonly pid = 4242;
  readonly stdout = new FakeStreams();
  readonly stderr = new FakeStreams();
  readonly stdin = new FakeStdin();
  private readonly closeListeners: ((code: number | null, signal: string | null) => void)[] = [];
  private readonly errorListeners: ((err: Error) => void)[] = [];
  readonly killSignals: string[] = [];

  // A single broad method satisfies BOTH interface overloads (the whisper
  // suite's contravariance note, verbatim).
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
  spawnImpl: PiperSpawnEngineBinary;
} {
  const spawns: { binaryPath: string; args: readonly string[]; child: FakeChild }[] = [];
  const spawnImpl: PiperSpawnEngineBinary = (binaryPath, args) => {
    const child = new FakeChild();
    spawns.push({ binaryPath, args, child });
    return child;
  };
  return { spawns, spawnImpl };
}

const VOICE_ID = "en_US-amy-medium";
/** The voice as discovered from the HOME-templated standard directory. */
const VOICE_PATH = "/home/u/.local/share/piper/voices/en_US-amy-medium.onnx";
const OUTPUT_PATH = "/tmp/webflix-piper-test.wav";
const SYNTH_AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

const BASE_ENV: PiperEngineProcessEnv = { PATH: "/x/bin", HOME: "/home/u" };

/** The default existence probe: the binary exists (voices come from the listing seam). */
const defaultExists = (p: string): boolean => p === "/x/bin/piper";

/** The default voice listing: one .onnx in the HOME-templated standard dir (plus non-model noise). */
const defaultListVoiceFiles = (dir: string): readonly string[] =>
  dir === "/home/u/.local/share/piper/voices"
    ? [`${VOICE_ID}.onnx`, "README.md", "notes.txt", "es_ES-mls-medium.onnx.json"]
    : [];

/** Engine over the pinned facts with every seam injected. */
function makeEngine(
  over: {
    env?: Record<string, string | undefined>;
    exists?: (p: string) => boolean;
    listVoiceFiles?: (dir: string) => readonly string[];
    readAudioFile?: (path: string) => Promise<Uint8Array>;
    spawnImpl?: PiperSpawnEngineBinary;
  } = {},
): {
  engine: PiperLocalTtsEngine;
  spawns: { binaryPath: string; args: readonly string[]; child: FakeChild }[];
} {
  const seam = makeSpawnSeam();
  const options: PiperLocalTtsEngineOptions = {
    processEnv: { ...BASE_ENV, ...over.env },
    existsOnDisk: over.exists ?? defaultExists,
    listVoiceFiles: over.listVoiceFiles ?? defaultListVoiceFiles,
    readAudioFile:
      over.readAudioFile ??
      (async (path: string) => {
        if (path !== OUTPUT_PATH) throw new Error(`no such output file: ${path}`);
        return SYNTH_AUDIO;
      }),
    makeOutputPath: () => OUTPUT_PATH,
    spawnImpl: over.spawnImpl ?? seam.spawnImpl,
  };
  return { engine: new PiperLocalTtsEngine(options), spawns: seam.spawns };
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
  text: "welcome to the brave new world",
  voice: { id: VOICE_ID },
} as const;

describe("PiperLocalTtsEngine (hermetic — canned children + canned audio only)", () => {
  // -------------------------------------------------------------------------
  // Engine discovery (pure function of env + probe)
  // -------------------------------------------------------------------------
  it("engine discovery: the absolute override wins; PATH beats standard; nothing => honest null", () => {
    expect(
      discoverPiperBinary(
        { ...BASE_ENV, WEBFLIX_PIPER_BIN: "/opt/piper/piper" },
        (p) => p === "/opt/piper/piper",
      ),
    ).toBe("/opt/piper/piper");
    expect(
      discoverPiperBinary({ PATH: "/x/bin:/y/bin", HOME: "/home/u" }, (p) => p === "/y/bin/piper"),
    ).toBe("/y/bin/piper");
    expect(
      discoverPiperBinary(
        { ...BASE_ENV, WEBFLIX_PIPER_BIN: "/gone/piper" },
        (p) => p === "/home/u/.local/bin/piper",
      ),
    ).toBe("/home/u/.local/bin/piper");
    expect(discoverPiperBinary({ PATH: "", HOME: "/home/u" }, () => false)).toBeNull();
    expect(PIPER_BINARY_NAMES).toEqual(["piper"]);
  });

  // -------------------------------------------------------------------------
  // Voice discovery (pure function of env + probes)
  // -------------------------------------------------------------------------
  it("voice discovery: the override's filename stem is the id; standard dirs add .onnx voices (stems = ids)", () => {
    const voices = discoverPiperVoices(
      { ...BASE_ENV, WEBFLIX_PIPER_VOICE: "/custom/my-voice.onnx" },
      (p) => p === "/custom/my-voice.onnx",
      (dir) => (dir === "/home/u/.local/share/piper/voices" ? ["other.onnx", "x.txt"] : []),
    );
    // Dedupe by id, id-sorted, .onnx only, override first-class.
    expect(voices.map((voice) => voice.id)).toEqual(["my-voice", "other"]);
    expect(voices[0]?.modelPath).toBe("/custom/my-voice.onnx");
  });

  it("voice discovery: an id collision dedupes with the OVERRIDE winning; a stale override falls through", () => {
    const voices = discoverPiperVoices(
      { ...BASE_ENV, WEBFLIX_PIPER_VOICE: "/custom/amy.onnx" },
      (p) => p === "/custom/amy.onnx",
      (dir) => (dir === "/usr/share/piper/voices" ? ["amy.onnx"] : []),
    );
    expect(voices).toHaveLength(1);
    expect(voices[0]?.modelPath).toBe("/custom/amy.onnx");
    // A stale override (not on disk) is an honest miss — the scan still runs.
    const fallback = discoverPiperVoices(
      { ...BASE_ENV, WEBFLIX_PIPER_VOICE: "/gone/amy.onnx" },
      () => false,
      (dir) => (dir === "/usr/share/piper/voices" ? ["amy.onnx"] : []),
    );
    expect(fallback.map((voice) => voice.id)).toEqual(["amy"]);
    expect(fallback[0]?.modelPath).toBe("/usr/share/piper/voices/amy.onnx");
  });

  it("voice discovery: nothing anywhere => the honest empty list", () => {
    expect(
      discoverPiperVoices(
        BASE_ENV,
        () => false,
        () => [],
      ),
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Availability (both facts, without running anything)
  // -------------------------------------------------------------------------
  it("availability(): the engine fact, the voice list, and both recovery hints", () => {
    const { engine } = makeEngine();
    const availability = engine.availability();
    expect(availability.available).toBe(true);
    expect(availability.binaryPath).toBe("/x/bin/piper");
    expect(availability.voices.map((voice) => voice.id)).toEqual([VOICE_ID]);
    expect(availability.engineRecoveryHint).toBe(PIPER_ENGINE_RECOVERY_HINT);
    expect(availability.voiceRecoveryHint).toBe(PIPER_VOICE_RECOVERY_HINT);
  });

  // -------------------------------------------------------------------------
  // Honest absence — twice
  // -------------------------------------------------------------------------
  it("engine-absent => the TYPED tts-engine-unavailable error with the ENGINE hint", async () => {
    const engine = new PiperLocalTtsEngine({
      processEnv: { PATH: "", HOME: "/home/u" },
      existsOnDisk: () => false,
      listVoiceFiles: () => [],
      readAudioFile: async () => SYNTH_AUDIO,
      makeOutputPath: () => OUTPUT_PATH,
      spawnImpl: makeSpawnSeam().spawnImpl,
    });
    const err = await expectWebFlixErrorAsync(
      () => engine.synthesize({ ...REQUEST }),
      ErrorCode.IntelligenceTtsEngineUnavailable,
    );
    expect(err.reason).toContain("no Piper-class binary found");
    expect(err.reason).toContain(PIPER_ENGINE_RECOVERY_HINT);
  });

  it("unknown requested voice => the TYPED tts-engine-unavailable error with the VOICE hint and the discovered set", async () => {
    const { engine, spawns } = makeEngine();
    const err = await expectWebFlixErrorAsync(
      () => engine.synthesize({ text: "hello", voice: { id: "de_DE-karl" } }),
      ErrorCode.IntelligenceTtsEngineUnavailable,
    );
    expect(err.reason).toContain('no piper voice model "de_DE-karl"');
    expect(err.reason).toContain("discovered voices: en_US-amy-medium");
    expect(err.reason).toContain(PIPER_VOICE_RECOVERY_HINT);
    expect(spawns).toHaveLength(0); // never spawned for an unresolvable voice
  });

  // -------------------------------------------------------------------------
  // The run shape + honest audio
  // -------------------------------------------------------------------------
  it("happy path: --model <voice.onnx> --output_file <out.wav>, the text written to STDIN once, audio read back from EXACTLY the output path", async () => {
    const readPaths: string[] = [];
    const { engine, spawns } = makeEngine({
      readAudioFile: async (path) => {
        readPaths.push(path);
        return SYNTH_AUDIO;
      },
    });
    const run = engine.synthesize({ ...REQUEST });
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.binaryPath).toBe("/x/bin/piper");
    expect(spawns[0]?.args).toEqual(["--model", VOICE_PATH, "--output_file", OUTPUT_PATH]);
    expect(spawns[0]?.child.stdin.written).toEqual(["welcome to the brave new world"]);
    spawns[0]?.child.emitStderr("Loading model from 'voices/en_US-amy-medium.onnx'\n");
    spawns[0]?.child.emitClose(0, null);
    const result = await run;
    expect(readPaths).toEqual([OUTPUT_PATH]);
    expect(result.contentType).toBe("audio/wav");
    expect(Array.from(result.audio)).toEqual(Array.from(SYNTH_AUDIO));
    // Lineage: the model-load banner parsed; no version banner printed.
    expect(result.modelLineage).toBe("voices/en_US-amy-medium.onnx");
    expect(result.engineVersion).toBeUndefined();
  });

  it("non-zero exit => typed tts-engine-failed with the binary's own stderr first line", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitStderr("Error: model file not found\nsecond line\n");
    spawns[0]?.child.emitClose(1, null);
    const err = await expectWebFlixErrorAsync(() => run, ErrorCode.IntelligenceTtsEngineFailed);
    expect(err.reason).toContain("exited with code 1");
    expect(err.reason).toContain("Error: model file not found");
  });

  it("spawn error => typed tts-engine-failed (the binary could not be executed)", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitError(new Error("ENOENT"));
    await expectWebFlixErrorAsync(() => run, ErrorCode.IntelligenceTtsEngineFailed);
  });

  it("an UNREADABLE output file => typed tts-engine-failed (never an empty success)", async () => {
    const { engine, spawns } = makeEngine({
      readAudioFile: async () => {
        throw new Error("ENOENT");
      },
    });
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitClose(0, null);
    const err = await expectWebFlixErrorAsync(() => run, ErrorCode.IntelligenceTtsEngineFailed);
    expect(err.reason).toContain("could not be read back");
  });

  it("an EMPTY output file => typed tts-engine-failed — an engine that wrote no audio is a failed run", async () => {
    const { engine, spawns } = makeEngine({
      readAudioFile: async () => new Uint8Array([]),
    });
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitClose(0, null);
    const err = await expectWebFlixErrorAsync(() => run, ErrorCode.IntelligenceTtsEngineFailed);
    expect(err.reason).toContain("wrote no audio");
  });

  it("lineage is CONSERVATIVE: a version banner parsed only from the documented shape; noise stays absent", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitStdout("piper 1.2.0\n");
    spawns[0]?.child.emitClose(0, null);
    const result = await run;
    expect(result.engineVersion).toBe("1.2.0");
    expect(result.modelLineage).toBeUndefined(); // no model banner this run
  });

  it("the run is ONE honest work unit: progress 1/1 after exit", async () => {
    const { engine, spawns } = makeEngine();
    const seen: TtsEngineProgress[] = [];
    const run = engine.synthesize({ ...REQUEST }, { onProgress: (p) => seen.push(p) });
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
      () => engine.synthesize({ ...REQUEST }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.reason).toContain("before the binary was spawned");
    expect(spawns).toHaveLength(0);
  });

  it("mid-run cancellation: the child is KILLED and the run rejects typed cancelled", async () => {
    const { engine, spawns } = makeEngine();
    const controller = new AbortController();
    const run = engine.synthesize({ ...REQUEST }, { signal: controller.signal });
    controller.abort();
    spawns[0]?.child.emitClose(null, "SIGTERM");
    const err = await expectWebFlixErrorAsync(() => run, ErrorCode.Cancelled);
    expect(err.reason).toContain("terminated mid-run");
    expect(spawns[0]?.child.killSignals).toEqual(["SIGTERM"]);
  });

  it("an EXTERNAL SIGKILL also maps to the honest cancelled outcome", async () => {
    const { engine, spawns } = makeEngine();
    const run = engine.synthesize({ ...REQUEST });
    spawns[0]?.child.emitClose(null, "SIGKILL");
    await expectWebFlixErrorAsync(() => run, ErrorCode.Cancelled);
  });

  // -------------------------------------------------------------------------
  // The adapter's own identity (always known — never guessed)
  // -------------------------------------------------------------------------
  it("the descriptor pins the adapter identity and the honest-absent lineage", () => {
    const { engine } = makeEngine();
    expect(engine.descriptor.id).toBe(PIPER_LOCAL_TTS_ENGINE_ID);
    expect(engine.descriptor.version).toBe(PIPER_LOCAL_TTS_ENGINE_VERSION);
    expect(engine.descriptor).toEqual(PIPER_LOCAL_TTS_ENGINE_DESCRIPTOR);
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();
  });
});
