/**
 * WhisperCppLocalEngine — the REAL local transcription-engine adapter
 * (P4-TRANSCRIBE scope row 3b) on the local-library seam.
 *
 * WHY THIS PACKAGE: the application layer is platform-pure (no node types,
 * no filesystem, no child processes — its tsc config pins `types: []`);
 * this seam already owns every machine-bound adapter (better-sqlite3
 * storage, path-safe indexing, backup). The adapter implements the
 * `TranscriptionEnginePort` INTERFACE from @webflix/contracts directly
 * (structural typing wires it into mi.transcribe's `engine` dependency —
 * the same port-mirror precedent the MI stores use, no cross-package edge).
 *
 * NO ENGINE IS BUNDLED. This adapter SHELLS OUT to a whisper.cpp-class
 * binary the user installed on THIS machine (MIT-family license, verified
 * in docs/plans/audits/AUDIT-SOURCES.md §6; phase4-mi-plan §7). Its honesty
 * rules, binding:
 *
 * - AVAILABILITY IS A FACT, NOT A GUESS: the binary is located by
 *   discovery — the WEBFLIX_WHISPER_BIN override first, then PATH lookup,
 *   then standard install locations. When nothing is found, transcribe()
 *   rejects with the TYPED intelligence/engine-unavailable error carrying
 *   the recovery hint ("install whisper.cpp and set WEBFLIX_WHISPER_BIN")
 *   — the Reddit-block honesty pattern: surfaced, never hidden, never a
 *   silent empty result. `availability()` answers the same fact without
 *   running anything.
 * - LINEAGE COMES FROM THE BINARY'S OWN OUTPUT ONLY: engineVersion and
 *   modelLineage are parsed from what the binary itself printed on THIS
 *   run (system/version banners, "loading model from" lines). When the
 *   binary reports nothing, the fields stay ABSENT — never guessed, never
 *   defaulted. The ADAPTER's own identity (id/label/version) is our code's
 *   and always known.
 * - LOCAL ONLY: the only I/O is the child process on THIS machine; no
 *   network, no model downloads, no provider reads — ever. Audio decode /
 *   demux / probing are ENGINE-INTERNAL (the work order's honest non-goal):
 *   the media path is passed to the binary untouched.
 * - CANCELLATION: the signal is honoured at the boundary (checked before
 *   the child is spawned) and mid-run (the child process is KILLED when
 *   the signal aborts; the run rejects with the typed common/cancelled
 *   error). stdout/stderr are parsed ONLY after the process exits.
 * - The spawn seam is injectable (`spawnImpl`, default node:child_process
 *   spawn) so tests replay canned child behaviour WITHOUT any process I/O;
 *   the default is the only place a real binary runs. The environment is
 *   injected too (`processEnv`, default node:process env) so discovery is
 *   fully deterministic under test.
 *
 * Output parsing is deliberately conservative: segments are read from
 * whisper.cpp's JSON-lines stdout (each line schema-validated through
 * TranscriptSegmentSchema); anything unparsable is skipped as non-JSON
 * noise (progress banners are not transcripts) — never fabricated.
 */
import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import { accessSync, constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ErrorCode, TranscriptSegmentSchema, WebFlixError } from "webflix-contracts";
import type {
  TranscriptionEngineDescriptor,
  TranscriptionEnginePort,
  TranscriptionOptions,
  TranscriptionProgress,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptSegment,
} from "webflix-contracts";

/** The adapter's identity — OUR code's, always known. */
export const WHISPER_CPP_LOCAL_ENGINE_ID = "webflix.whisper-cpp-local";
export const WHISPER_CPP_LOCAL_ENGINE_VERSION = "0.1.0";

/** The recovery hint surfaced with the honest engine-unavailable state. */
export const WHISPER_CPP_RECOVERY_HINT = "install whisper.cpp and set WEBFLIX_WHISPER_BIN";

/**
 * Binary names a whisper.cpp-class install may carry: whisper.cpp's own
 * main binary names — `whisper-cli` (current) and `main` (classic build) —
 * plus `whisper.cpp` used by some package managers.
 */
export const WHISPER_BINARY_NAMES: readonly string[] = ["whisper-cli", "main", "whisper.cpp"];

/** Directory roots searched AFTER the override and PATH (HOME resolved per call). */
const WHISPER_STANDARD_LOCATION_TEMPLATES: readonly string[] = [
  "/usr/local/bin",
  "/usr/bin",
  "/opt/homebrew/bin",
  "${HOME}/.local/bin",
  "${HOME}/bin",
];

/** The descriptor this adapter exposes (lineage honestly absent until read from a run). */
export const WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR: TranscriptionEngineDescriptor = {
  id: WHISPER_CPP_LOCAL_ENGINE_ID,
  label: "whisper.cpp (local)",
  version: WHISPER_CPP_LOCAL_ENGINE_VERSION,
  licenseNote: "whisper.cpp is MIT licensed; model files carry their own licenses",
};

// ---------------------------------------------------------------------------
// Spawn seam (injectable; the default is the ONLY real-process path)
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

/** The spawn seam. Default: node:child_process.spawn with piped stdio. */
export type SpawnEngineBinary = (
  binaryPath: string,
  args: readonly string[],
) => EngineChildProcess & {
  readonly stdout: EngineChildStreams;
  readonly stderr: EngineChildStreams;
};

/** Injected process-environment seam (node:process env in production, pinned maps in tests). */
export interface EngineProcessEnv {
  readonly PATH?: string;
  readonly HOME?: string;
  readonly WEBFLIX_WHISPER_BIN?: string;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * The binary path this adapter would run, or null when NO whisper.cpp-class
 * binary is discoverable on this machine. Search order (first hit wins):
 * 1. WEBFLIX_WHISPER_BIN (an absolute executable path, or a bare name
 *    resolved on PATH);
 * 2. PATH lookup for each candidate binary name;
 * 3. standard install locations (HOME-templated) for each candidate name.
 * Discovery is a pure function of (env, existsOnDisk) — deterministic and
 * side-effect-free beyond the injected probe.
 */
export function discoverWhisperBinary(
  processEnv: EngineProcessEnv = nodeProcessEnv,
  existsOnDisk: (path: string) => boolean = pathExists,
): string | null {
  // 1. The explicit override: an absolute executable path wins as-is; a
  //    bare name falls through to PATH resolution (so the override can
  //    name either a full path or an installed command).
  const override = processEnv.WEBFLIX_WHISPER_BIN;
  if (override !== undefined && override.trim().length > 0) {
    const trimmed = override.trim();
    if (isAbsolute(trimmed) && existsOnDisk(trimmed)) return trimmed;
    const onPath = resolveOnPath(trimmed, processEnv.PATH ?? "", existsOnDisk);
    if (onPath !== null) return onPath;
    // An override that resolves nowhere is an honest miss — fall through
    // to the standard search rather than erroring (the user may have set
    // a stale value; discovery states the machine's real fact).
  }
  // 2. PATH lookup per candidate name.
  for (const name of WHISPER_BINARY_NAMES) {
    const hit = resolveOnPath(name, processEnv.PATH ?? "", existsOnDisk);
    if (hit !== null) return hit;
  }
  // 3. Standard locations per candidate name.
  for (const directory of standardLocations(processEnv)) {
    for (const name of WHISPER_BINARY_NAMES) {
      const candidate = join(directory, name);
      if (existsOnDisk(candidate)) return candidate;
    }
  }
  return null;
}

/** Standard install locations with HOME resolved (unresolved when HOME absent). */
function standardLocations(processEnv: EngineProcessEnv): readonly string[] {
  const home = processEnv.HOME;
  return WHISPER_STANDARD_LOCATION_TEMPLATES.map((template) =>
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

/** The production environment (read lazily, never at import time). */
const nodeProcessEnv: EngineProcessEnv = {
  get PATH(): string | undefined {
    return process.env.PATH;
  },
  get HOME(): string | undefined {
    return process.env.HOME;
  },
  get WEBFLIX_WHISPER_BIN(): string | undefined {
    return process.env.WEBFLIX_WHISPER_BIN;
  },
};

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface WhisperCppLocalEngineOptions {
  /**
   * Injected spawn seam — tests replay canned children; the default spawns
   * the real binary (the ONLY real-process path in this module).
   */
  readonly spawnImpl?: SpawnEngineBinary;
  /** Injected environment — production reads node:process env lazily. */
  readonly processEnv?: EngineProcessEnv;
  /** Injected discovery probe (default: filesystem accessSync X_OK). */
  readonly existsOnDisk?: (path: string) => boolean;
}

/** One parsed JSON-line from the engine's stdout. */
interface WhisperJsonLine {
  readonly startMs?: number;
  readonly endMs?: number;
  readonly text?: string;
}

export class WhisperCppLocalEngine implements TranscriptionEnginePort {
  readonly descriptor: TranscriptionEngineDescriptor;
  private readonly spawnEngine: SpawnEngineBinary;
  private readonly processEnv: EngineProcessEnv;
  private readonly existsOnDisk: (path: string) => boolean;
  /** The discovered binary for THIS instance (null = honestly absent). */
  private readonly binaryPath: string | null;

  constructor(options: WhisperCppLocalEngineOptions = {}) {
    this.descriptor = WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR;
    this.spawnEngine = options.spawnImpl ?? defaultSpawnEngineBinary;
    this.processEnv = options.processEnv ?? nodeProcessEnv;
    this.existsOnDisk = options.existsOnDisk ?? pathExists;
    this.binaryPath = discoverWhisperBinary(this.processEnv, this.existsOnDisk);
  }

  /** The honest availability fact: the discovered path, or null (with the hint). */
  availability(): { available: boolean; binaryPath: string | null; recoveryHint: string } {
    return {
      available: this.binaryPath !== null,
      binaryPath: this.binaryPath,
      recoveryHint: WHISPER_CPP_RECOVERY_HINT,
    };
  }

  async transcribe(
    request: TranscriptionRequest,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    // 1. Honest availability: no binary on this machine => the typed
    //    engine-unavailable error, surfaced with the recovery hint.
    if (this.binaryPath === null) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceEngineUnavailable,
        reason: `no whisper.cpp-class binary found on this machine (searched WEBFLIX_WHISPER_BIN, PATH for ${WHISPER_BINARY_NAMES.join(", ")}, and standard locations) — ${WHISPER_CPP_RECOVERY_HINT}`,
        retryable: false,
        context: { recoveryHint: WHISPER_CPP_RECOVERY_HINT },
      });
    }
    // 2. Boundary cancellation: never spawn an already-cancelled run.
    if (options?.signal?.aborted === true) {
      throw cancellationError("whisper.cpp run cancelled before the binary was spawned");
    }

    // 3. Spawn the LOCAL binary with the media path untouched. Args follow
    //    whisper.cpp's CLI: the media file, JSON-lines output. No network
    //    exists in the binary itself (inference is local).
    const args: string[] = [request.mediaPath, "--print-json-lines"];
    if (request.language !== undefined) args.push("-l", request.language);
    const child = this.spawnEngine(this.binaryPath, args);

    // 4. Mid-run cancellation: kill the child; record it so the exit
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

    const exit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.on("error", (err) => {
          if (signal !== undefined) signal.removeEventListener("abort", onAbort);
          reject(
            new WebFlixError({
              code: ErrorCode.IntelligenceEngineFailed,
              reason: `the whisper binary could not be executed: ${err.message}`,
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

    // 5. Map the exit to the honest outcome.
    if (killed || exit.signal === "SIGTERM" || exit.signal === "SIGKILL") {
      throw cancellationError("whisper.cpp run cancelled — the binary was terminated mid-run");
    }
    if (exit.code !== 0) {
      const stderrText = concatenate(stderrChunks).trim();
      throw new WebFlixError({
        code: ErrorCode.IntelligenceEngineFailed,
        reason: `the whisper binary exited with code ${exit.code}${stderrText.length > 0 ? `: ${firstLine(stderrText)}` : ""}`,
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, exitCode: exit.code },
      });
    }

    // 6. Parse segments from the binary's OWN stdout — JSON lines only;
    //    anything unparsable is non-transcript noise, skipped, never
    //    fabricated. Empty is the honest "engine reported no speech".
    const stdoutText = concatenate(stdoutChunks);
    const segments: TranscriptSegment[] = [];
    for (const line of stdoutText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = parseJsonLine(trimmed);
      if (parsed === null) continue;
      const candidate = {
        startMs: numberToIntegerMs(parsed.startMs),
        endMs: numberToIntegerMs(parsed.endMs),
        text: typeof parsed.text === "string" ? parsed.text.trim() : undefined,
      };
      const validated = TranscriptSegmentSchema.safeParse(candidate);
      if (!validated.success) continue; // a malformed line is noise, not a segment
      segments.push(validated.data);
      // Progress between segments (honestly known: parsed-so-far count;
      // totalSegments deliberately ABSENT — a streaming run cannot know it).
      options?.onProgress?.({
        completedSegments: segments.length,
        lastEndMs: validated.data.endMs,
      } satisfies TranscriptionProgress);
    }

    // 7. Lineage: only what the binary ITSELF printed on THIS run.
    const combinedOutput = `${stdoutText}\n${concatenate(stderrChunks)}`;
    const engineVersion = matchFirst(combinedOutput, WHISPER_VERSION_RE);
    const modelLineage = matchFirst(combinedOutput, WHISPER_MODEL_RE);
    const language = matchFirst(combinedOutput, WHISPER_LANGUAGE_RE);
    return {
      segments,
      ...(engineVersion !== null ? { engineVersion } : {}),
      ...(modelLineage !== null ? { modelLineage } : {}),
      ...(language !== null ? { language } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (conservative; the binary's own output is the only source)
// ---------------------------------------------------------------------------

/** whisper.cpp system/version banner lines, e.g. "whisper.cpp: version = 1.7.4". */
const WHISPER_VERSION_RE =
  /whisper[._-]?(?:cpp|cli)[^\n]{0,80}?version\s*[:=]\s*([0-9][0-9a-zA-Z.-]*)/i;
/** Model-load lines, e.g. "whisper_init_from_file_with_params_no_state: loading model from 'models/ggml-base.en-q5_1.bin'". */
const WHISPER_MODEL_RE = /loading model from\s+'([^']+)'/i;
/** Language report lines, e.g. "whisper_init_state: ... language = en". */
const WHISPER_LANGUAGE_RE = /language\s*[:=]\s*([a-z]{2}(?:-[A-Za-z]{2,4})?)(?:\s|,|$)/i;

function matchFirst(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const captured = match[1]?.trim();
  if (captured === undefined || captured.length === 0) return null;
  return captured;
}

/** Parses one stdout line as a JSON object; null for anything else. */
function parseJsonLine(line: string): WhisperJsonLine | null {
  if (!line.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as WhisperJsonLine;
  } catch {
    return null;
  }
}

/** Coerces a JSON number to integer ms when it is a finite non-negative number. */
function numberToIntegerMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
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

/** The default spawn seam — node:child_process with piped stdio. */
const defaultSpawnEngineBinary: SpawnEngineBinary = (binaryPath, args) =>
  spawn(binaryPath, [...args], { stdio: ["ignore", "pipe", "pipe"] }) as EngineChildProcess & {
    stdout: EngineChildStreams;
    stderr: EngineChildStreams;
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
