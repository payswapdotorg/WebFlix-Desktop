/**
 * PiperLocalTtsEngine — the REAL local TTS-engine adapter (P4-TRANSLATE
 * scope row 3) on the local-library seam, mirroring WhisperCppLocalEngine
 * (the work order says so in exactly those words) plus the VOICE-model
 * discovery layer TTS needs.
 *
 * WHY THIS PACKAGE: the application layer is platform-pure (no node types,
 * no filesystem, no child processes — its tsc config pins `types: []`);
 * this seam already owns every machine-bound adapter. The adapter
 * implements the `TtsEnginePort` INTERFACE from webflix-contracts directly
 * (structural typing wires it into mi.tts's `engine` dependency — the same
 * port-mirror precedent the MI stores use).
 *
 * NO ENGINE AND NO VOICE MODEL IS BUNDLED. This adapter SHELLS OUT to a
 * Piper-class binary the user installed on THIS machine, with a voice
 * model (.onnx) the user placed in a standard voice directory (or named
 * through WEBFLIX_PIPER_VOICE). Piper is MIT-family licensed (verified in
 * docs/plans/audits/AUDIT-SOURCES.md §6; phase4-mi-plan §7 — engines under
 * non-commercial licenses are banned from this seam entirely). Honesty
 * rules, binding:
 *
 * - AVAILABILITY IS A FACT, NOT A GUESS, TWICE: the ENGINE binary is
 *   located by discovery — WEBFLIX_PIPER_BIN, then PATH lookup, then
 *   standard install locations; the VOICE models are located by discovery
 *   — the WEBFLIX_PIPER_VOICE override (an absolute .onnx path), then a
 *   flat scan of the standard voice directories. A requested voice id is
 *   resolved against the DISCOVERED voices (id = the .onnx filename
 *   stem). When the engine OR the requested voice is absent, synthesize()
 *   rejects with the TYPED intelligence/tts-engine-unavailable error
 *   carrying the recovery hint naming WHICH fact was absent — surfaced,
 *   never hidden, never a silent empty result. `availability()` answers
 *   both facts without running anything.
 * - LINEAGE COMES FROM THE BINARY'S OWN OUTPUT ONLY: engineVersion and
 *   modelLineage are parsed from what the binary itself printed on THIS
 *   run. When the binary reports nothing, the fields stay ABSENT — never
 *   guessed, never defaulted. The ADAPTER's own identity
 *   (id/label/version) is our code's and always known.
 * - AUDIO FROM THE ENGINE'S OWN OUTPUT PATH: the run passes
 *   `--output_file <path>` and the bytes are READ BACK from exactly that
 *   path after the engine exits — never synthesized, never substituted. A
 *   missing/empty output file is a typed engine-failed run.
 * - LOCAL ONLY: the only I/O is the child process and its output file on
 *   THIS machine; no network, no voice/model downloads, no provider reads
 *   — ever.
 * - CANCELLATION: the signal is honoured at the boundary (checked before
 *   the child is spawned) and mid-run (the child process is KILLED when
 *   the signal aborts; the run rejects with the typed common/cancelled
 *   error). stdout/stderr are parsed ONLY after the process exits.
 * - The seams are injectable (`spawnImpl`, `processEnv`, `existsOnDisk`,
 *   `listVoiceFiles`, `readAudioFile`, `makeOutputPath`) so tests replay
 *   canned children and canned audio WITHOUT any process or file I/O; the
 *   defaults are the only places real I/O happens.
 *
 * The run shape follows Piper's documented CLI:
 * `piper --model <voice.onnx> --output_file <out.wav>` with the text on
 * STDIN (the `echo 'text' | piper …` shape).
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { accessSync, constants } from "node:fs";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TtsEngineDescriptor,
  TtsEngineOptions,
  TtsEnginePort,
  TtsEngineProgress,
  TtsRequest,
  TtsResult,
} from "webflix-contracts";

/** The adapter's identity — OUR code's, always known. */
export const PIPER_LOCAL_TTS_ENGINE_ID = "webflix.piper-local-tts";
export const PIPER_LOCAL_TTS_ENGINE_VERSION = "0.1.0";

/** The recovery hint surfaced with the honest engine-unavailable state. */
export const PIPER_ENGINE_RECOVERY_HINT = "install piper and set WEBFLIX_PIPER_BIN";
/** The recovery hint for the voice-model-absent state. */
export const PIPER_VOICE_RECOVERY_HINT =
  "place a piper voice model (.onnx) in a standard voice directory or set WEBFLIX_PIPER_VOICE";

/** Binary names a Piper-class install may carry. */
export const PIPER_BINARY_NAMES: readonly string[] = ["piper"];

/** Directory roots searched AFTER the override and PATH (HOME resolved per call). */
const PIPER_STANDARD_LOCATION_TEMPLATES: readonly string[] = [
  "/usr/local/bin",
  "/usr/bin",
  "/opt/homebrew/bin",
  "${HOME}/.local/bin",
  "${HOME}/bin",
];

/** Voice-directory roots scanned for .onnx voice models (HOME resolved per call). */
const PIPER_VOICE_DIR_TEMPLATES: readonly string[] = [
  "/usr/local/share/piper/voices",
  "/usr/share/piper/voices",
  "${HOME}/.local/share/piper/voices",
  "${HOME}/.piper/voices",
];

/** The descriptor this adapter exposes (lineage honestly absent until read from a run). */
export const PIPER_LOCAL_TTS_ENGINE_DESCRIPTOR: TtsEngineDescriptor = {
  id: PIPER_LOCAL_TTS_ENGINE_ID,
  label: "Piper-class TTS (local)",
  version: PIPER_LOCAL_TTS_ENGINE_VERSION,
  licenseNote: "Piper is MIT-family licensed; voice models carry their own licenses",
};

// ---------------------------------------------------------------------------
// Spawn + I/O seams (injectable; the defaults are the ONLY real-I/O paths)
// ---------------------------------------------------------------------------

/** Minimal child handle the adapter needs (a subset of ChildProcess). */
export interface EngineChildProcess {
  readonly pid: number | undefined;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null, signal: string | null) => void): void;
  kill(signal?: string): void;
}

/** What the adapter needs from stdout/stderr (a subset of Readable). */
export interface EngineChildStreams {
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

/** What the adapter needs from stdin (a subset of Writable) — piper reads the text from stdin. */
export interface EngineChildStdin {
  write(chunk: string): void;
  end(): void;
}

/** The spawn seam. Default: node:child_process.spawn with piped stdio. */
export type SpawnEngineBinary = (
  binaryPath: string,
  args: readonly string[],
) => EngineChildProcess & {
  readonly stdout: EngineChildStreams;
  readonly stderr: EngineChildStreams;
  readonly stdin: EngineChildStdin;
};

/** Injected process-environment seam (node:process env in production, pinned maps in tests). */
export interface EngineProcessEnv {
  readonly PATH?: string;
  readonly HOME?: string;
  readonly WEBFLIX_PIPER_BIN?: string;
  readonly WEBFLIX_PIPER_VOICE?: string;
}

// ---------------------------------------------------------------------------
// Discovery — the engine binary AND the voice models
// ---------------------------------------------------------------------------

/** One discovered voice model: its id (the .onnx filename stem) and path. */
export interface DiscoveredPiperVoice {
  readonly id: string;
  readonly modelPath: string;
}

/**
 * The binary path this adapter would run, or null when NO Piper-class
 * binary is discoverable on this machine. Search order (first hit wins):
 * 1. WEBFLIX_PIPER_BIN (an absolute executable path, or a bare name
 *    resolved on PATH);
 * 2. PATH lookup for each candidate binary name;
 * 3. standard install locations (HOME-templated) for each candidate name.
 * Discovery is a pure function of (env, existsOnDisk) — deterministic and
 * side-effect-free beyond the injected probe.
 */
export function discoverPiperBinary(
  processEnv: EngineProcessEnv = nodeProcessEnv,
  existsOnDisk: (path: string) => boolean = pathExists,
): string | null {
  const override = processEnv.WEBFLIX_PIPER_BIN;
  if (override !== undefined && override.trim().length > 0) {
    const trimmed = override.trim();
    if (isAbsolute(trimmed) && existsOnDisk(trimmed)) return trimmed;
    const onPath = resolveOnPath(trimmed, processEnv.PATH ?? "", existsOnDisk);
    if (onPath !== null) return onPath;
    // An override that resolves nowhere is an honest miss — fall through.
  }
  for (const name of PIPER_BINARY_NAMES) {
    const hit = resolveOnPath(name, processEnv.PATH ?? "", existsOnDisk);
    if (hit !== null) return hit;
  }
  for (const directory of standardLocations(processEnv)) {
    for (const name of PIPER_BINARY_NAMES) {
      const candidate = join(directory, name);
      if (existsOnDisk(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The voice models discoverable on this machine: the WEBFLIX_PIPER_VOICE
 * override (an absolute .onnx path — its filename stem is the voice id)
 * plus every *.onnx file in the standard voice directories (flat scan,
 * filename stem = voice id). Deterministic: deduped by id (the override
 * wins) and sorted by id. A flat scan is deliberate — recursive scanning
 * would make "which voice won" depend on directory layout.
 */
export function discoverPiperVoices(
  processEnv: EngineProcessEnv = nodeProcessEnv,
  existsOnDisk: (path: string) => boolean = pathExists,
  listVoiceFiles: (directory: string) => readonly string[] = listDirectoryFiles,
): readonly DiscoveredPiperVoice[] {
  const byId = new Map<string, DiscoveredPiperVoice>();
  const override = processEnv.WEBFLIX_PIPER_VOICE;
  if (override !== undefined && override.trim().length > 0) {
    const trimmed = override.trim();
    if (trimmed.toLowerCase().endsWith(".onnx") && isAbsolute(trimmed) && existsOnDisk(trimmed)) {
      byId.set(basename(trimmed, ".onnx"), { id: basename(trimmed, ".onnx"), modelPath: trimmed });
    }
    // An override that resolves nowhere is an honest miss — the standard
    // scan still runs (the user may have set a stale value).
  }
  for (const directory of voiceDirectories(processEnv)) {
    for (const file of listVoiceFiles(directory)) {
      if (file.toLowerCase().endsWith(".onnx")) {
        const id = basename(file, ".onnx");
        if (!byId.has(id)) {
          byId.set(id, { id, modelPath: join(directory, file) });
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Standard install locations with HOME resolved (unresolved when HOME absent). */
function standardLocations(processEnv: EngineProcessEnv): readonly string[] {
  const home = processEnv.HOME;
  return PIPER_STANDARD_LOCATION_TEMPLATES.map((template) =>
    home !== undefined && home.length > 0 ? template.replaceAll("${HOME}", home) : template,
  );
}

/** Voice directories with HOME resolved (unresolved when HOME absent). */
function voiceDirectories(processEnv: EngineProcessEnv): readonly string[] {
  const home = processEnv.HOME;
  return PIPER_VOICE_DIR_TEMPLATES.map((template) =>
    home !== undefined && home.length > 0 ? template.replaceAll("${HOME}", home) : template,
  );
}

/** First existing `dir/name` across the PATH directories. */
function resolveOnPath(
  name: string,
  pathValue: string,
  existsOnDisk: (path: string) => boolean,
): string | null {
  if (pathValue.length === 0) return null;
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = join(directory, name);
    if (existsOnDisk(candidate)) return candidate;
  }
  return null;
}

/** Default disk-existence probe (executable bit included). */
function pathExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Default flat directory listing (files + directories, no recursion). */
function listDirectoryFiles(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    // A missing/unreadable voice directory is an honest empty scan.
    return [];
  }
}

/** The production environment (read lazily, never at import time). */
const nodeProcessEnv: EngineProcessEnv = {
  get PATH(): string | undefined {
    return process.env.PATH;
  },
  get HOME(): string | undefined {
    return process.env.HOME;
  },
  get WEBFLIX_PIPER_BIN(): string | undefined {
    return process.env.WEBFLIX_PIPER_BIN;
  },
  get WEBFLIX_PIPER_VOICE(): string | undefined {
    return process.env.WEBFLIX_PIPER_VOICE;
  },
};

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface PiperLocalTtsEngineOptions {
  /** Injected spawn seam — tests replay canned children. */
  readonly spawnImpl?: SpawnEngineBinary;
  /** Injected environment — production reads node:process env lazily. */
  readonly processEnv?: EngineProcessEnv;
  /** Injected engine-discovery probe (default: filesystem accessSync X_OK). */
  readonly existsOnDisk?: (path: string) => boolean;
  /** Injected voice-directory listing (default: flat readdirSync; tests pin file name sets). */
  readonly listVoiceFiles?: (directory: string) => readonly string[];
  /** Injected audio read-back seam (default: node:fs/promises readFile; tests return canned bytes). */
  readonly readAudioFile?: (path: string) => Promise<Uint8Array>;
  /** Injected output-path factory (default: a temp WAV path; tests pin it). */
  readonly makeOutputPath?: () => string;
}

/** Monotone counter for default output paths (per process). */
let defaultOutputCounter = 0;

export class PiperLocalTtsEngine implements TtsEnginePort {
  readonly descriptor: TtsEngineDescriptor;
  private readonly spawnEngine: SpawnEngineBinary;
  private readonly processEnv: EngineProcessEnv;
  private readonly existsOnDisk: (path: string) => boolean;
  private readonly listVoiceFiles: (directory: string) => readonly string[];
  private readonly readAudioFile: (path: string) => Promise<Uint8Array>;
  private readonly makeOutputPath: () => string;
  /** The discovered binary for THIS instance (null = honestly absent). */
  private readonly binaryPath: string | null;
  /** The discovered voices for THIS instance (deterministic, id-sorted). */
  private readonly voices: readonly DiscoveredPiperVoice[];

  constructor(options: PiperLocalTtsEngineOptions = {}) {
    this.descriptor = PIPER_LOCAL_TTS_ENGINE_DESCRIPTOR;
    this.spawnEngine = options.spawnImpl ?? defaultSpawnEngineBinary;
    this.processEnv = options.processEnv ?? nodeProcessEnv;
    this.existsOnDisk = options.existsOnDisk ?? pathExists;
    this.listVoiceFiles = options.listVoiceFiles ?? listDirectoryFiles;
    this.readAudioFile = options.readAudioFile ?? defaultReadAudioFile;
    this.makeOutputPath =
      options.makeOutputPath ??
      (() => join(tmpdir(), `webflix-piper-${Date.now()}-${(defaultOutputCounter += 1)}.wav`));
    this.binaryPath = discoverPiperBinary(this.processEnv, this.existsOnDisk);
    this.voices = discoverPiperVoices(this.processEnv, this.existsOnDisk, this.listVoiceFiles);
  }

  /**
   * The honest availability facts: the discovered engine path (or null),
   * the discovered voices, and both recovery hints — answered without
   * running anything.
   */
  availability(): {
    available: boolean;
    binaryPath: string | null;
    voices: readonly DiscoveredPiperVoice[];
    engineRecoveryHint: string;
    voiceRecoveryHint: string;
  } {
    return {
      available: this.binaryPath !== null,
      binaryPath: this.binaryPath,
      voices: this.voices,
      engineRecoveryHint: PIPER_ENGINE_RECOVERY_HINT,
      voiceRecoveryHint: PIPER_VOICE_RECOVERY_HINT,
    };
  }

  async synthesize(request: TtsRequest, options?: TtsEngineOptions): Promise<TtsResult> {
    // 1. Honest availability, fact one: no engine binary on this machine.
    if (this.binaryPath === null) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTtsEngineUnavailable,
        reason: `no Piper-class binary found on this machine (searched WEBFLIX_PIPER_BIN, PATH for ${PIPER_BINARY_NAMES.join(", ")}, and standard locations) — ${PIPER_ENGINE_RECOVERY_HINT}`,
        retryable: false,
        context: { recoveryHint: PIPER_ENGINE_RECOVERY_HINT },
      });
    }
    // 2. Honest availability, fact two: the requested voice resolves
    //    against the DISCOVERED voice models — an unknown id is the honest
    //    unavailable state, surfaced with the discovered set and the hint.
    const voice = this.voices.find((candidate) => candidate.id === request.voice.id);
    if (voice === undefined) {
      const available =
        this.voices.length > 0
          ? `; discovered voices: ${this.voices.map((candidate) => candidate.id).join(", ")}`
          : " (no voice models discovered)";
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTtsEngineUnavailable,
        reason: `no piper voice model "${request.voice.id}" found on this machine (checked the WEBFLIX_PIPER_VOICE override and the standard voice directories)${available} — ${PIPER_VOICE_RECOVERY_HINT}`,
        retryable: false,
        context: {
          recoveryHint: PIPER_VOICE_RECOVERY_HINT,
          requestedVoiceId: request.voice.id,
          discoveredVoiceIds: this.voices.map((candidate) => candidate.id),
        },
      });
    }
    // 3. Boundary cancellation: never spawn an already-cancelled run.
    if (options?.signal?.aborted === true) {
      throw cancellationError("piper synthesis cancelled before the binary was spawned");
    }

    // 4. Spawn the LOCAL binary. Args follow Piper's documented CLI:
    //    --model <voice.onnx> --output_file <out.wav>, text on STDIN.
    const outputPath = this.makeOutputPath();
    const args: string[] = ["--model", voice.modelPath, "--output_file", outputPath];
    const child = this.spawnEngine(this.binaryPath, args);

    // 5. Mid-run cancellation: kill the child; record it so the exit
    //    mapping turns the kill into the typed cancelled error.
    let killed = false;
    const signal = options?.signal;
    const onAbort = () => {
      killed = true;
      child.kill("SIGTERM");
    };
    if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });

    const stdoutChunks: (string | Buffer)[] = [];
    const stderrChunks: (string | Buffer)[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    // The text rides STDIN (piper's documented `echo 'text' | piper …`
    // shape) — written once, then the stream is closed.
    child.stdin.write(request.text);
    child.stdin.end();

    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.on("error", (err) => {
          if (signal !== undefined) signal.removeEventListener("abort", onAbort);
          reject(
            new WebFlixError({
              code: ErrorCode.IntelligenceTtsEngineFailed,
              reason: `the piper binary could not be executed: ${err.message}`,
              retryable: false,
              context: { binaryPath: this.binaryPath ?? undefined },
            }),
          );
        });
        child.on("close", (code, closeSignal) => {
          if (signal !== undefined) signal.removeEventListener("abort", onAbort);
          resolve({ code, signal: closeSignal });
        });
      },
    );

    // 6. Map the exit to the honest outcome.
    if (killed || exit.signal === "SIGTERM" || exit.signal === "SIGKILL") {
      throw cancellationError("piper synthesis cancelled — the binary was terminated mid-run");
    }
    if (exit.code !== 0) {
      const stderrText = concatenate(stderrChunks).trim();
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTtsEngineFailed,
        reason: `the piper binary exited with code ${exit.code}${stderrText.length > 0 ? `: ${firstLine(stderrText)}` : ""}`,
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, exitCode: exit.code },
      });
    }

    // The run is the single honest work unit (a spawn-based CLI engine):
    // one progress tick after exit, totals known exactly.
    options?.onProgress?.({ completedUnits: 1, totalUnits: 1 } satisfies TtsEngineProgress);

    // 7. AUDIO FROM THE ENGINE'S OWN OUTPUT PATH — read back from exactly
    //    the file the engine was told to write. Missing/empty is a FAILED
    //    run, never an empty success.
    let audio: Uint8Array<ArrayBuffer>;
    try {
      audio = new Uint8Array(await this.readAudioFile(outputPath));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTtsEngineFailed,
        reason: `the piper binary's output file could not be read back: ${detail}`,
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, outputPath },
      });
    }
    if (audio.length === 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTtsEngineFailed,
        reason: "the piper binary wrote no audio (its output file is empty)",
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, outputPath },
      });
    }

    // 8. Lineage: only what the binary ITSELF printed on THIS run.
    const combinedOutput = `${concatenate(stdoutChunks)}\n${concatenate(stderrChunks)}`;
    const engineVersion = matchFirst(combinedOutput, PIPER_VERSION_RE);
    const modelLineage = matchFirst(combinedOutput, PIPER_MODEL_RE);
    return {
      audio,
      contentType: "audio/wav",
      ...(engineVersion !== null ? { engineVersion } : {}),
      ...(modelLineage !== null ? { modelLineage } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (conservative; the binary's own output is the only source)
// ---------------------------------------------------------------------------

/**
 * Piper-class version banner lines. Two documented shapes: "piper 1.2.0"
 * (a bare version after the name) and "piper: version=1.2.0" / "piper
 * version 1.2.0" (explicit word). The bare-number branch requires the
 * digit DIRECTLY after the name + whitespace — "piper loaded 2 voices"
 * does NOT match (conservative, never a false lineage).
 */
const PIPER_VERSION_RE = /piper(?:[^\n]{0,40}?version\s*[:=v\s]*|[ \t]+v?)([0-9][0-9a-zA-Z.-]*)/i;
/** Model-load lines, e.g. "Loading model from 'voices/en_US-amy-medium.onnx'". */
const PIPER_MODEL_RE = /loading (?:voice )?model[^\n]{0,80}?from\s+['"]?([^'"\n]+)['"]?/i;

function matchFirst(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const captured = match[1]?.trim();
  if (captured === undefined || captured.length === 0) return null;
  return captured;
}

function concatenate(chunks: readonly (string | Buffer)[]): string {
  return chunks
    .map((chunk) => (typeof chunk === "string" ? chunk : chunk.toString("utf8")))
    .join("");
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** The default audio read-back seam — node:fs/promises readFile (Buffer IS a Uint8Array). */
const defaultReadAudioFile = async (path: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(path));

/** The default spawn seam — node:child_process with piped stdio (stdin included). */
const defaultSpawnEngineBinary: SpawnEngineBinary = (binaryPath, args) =>
  spawn(binaryPath, [...args], { stdio: ["pipe", "pipe", "pipe"] }) as EngineChildProcess & {
    stdout: EngineChildStreams;
    stderr: EngineChildStreams;
    stdin: EngineChildStdin;
  };

/** The typed cancellation error the adapter rejects with on abort. */
function cancellationError(reason: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.Cancelled,
    reason,
    retryable: false,
    context: { phase: "engine-run" },
  });
}
