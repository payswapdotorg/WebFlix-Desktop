/**
 * ArgosClassLocalTranslationEngine — the REAL local translation-engine
 * adapter (P4-TRANSLATE scope row 3) on the local-library seam, mirroring
 * WhisperCppLocalEngine (the work order says so in exactly those words).
 *
 * WHY THIS PACKAGE: the application layer is platform-pure (no node types,
 * no filesystem, no child processes — its tsc config pins `types: []`);
 * this seam already owns every machine-bound adapter. The adapter
 * implements the `TranslationEnginePort` INTERFACE from webflix-contracts
 * directly (structural typing wires it into mi.translate's `engine`
 * dependency — the same port-mirror precedent the MI stores use).
 *
 * NO ENGINE IS BUNDLED. This adapter SHELLS OUT to an Argos-class binary
 * the user installed on THIS machine (MIT-family license, verified in
 * docs/plans/audits/AUDIT-SOURCES.md §6; phase4-mi-plan §7 — engines under
 * non-commercial licenses are banned from this seam entirely). Its honesty
 * rules, binding:
 *
 * - AVAILABILITY IS A FACT, NOT A GUESS: the binary is located by
 *   discovery — the WEBFLIX_ARGOS_BIN override first, then PATH lookup,
 *   then standard install locations. When nothing is found, translate()
 *   rejects with the TYPED intelligence/translation-engine-unavailable
 *   error carrying the recovery hint ("install argos-translate and set
 *   WEBFLIX_ARGOS_BIN") — surfaced, never hidden, never a silent empty
 *   result. `availability()` answers the same fact without running
 *   anything.
 * - LINEAGE COMES FROM THE BINARY'S OWN OUTPUT ONLY: engineVersion and
 *   modelLineage are parsed from what the binary itself printed on THIS
 *   run (version banners). When the binary reports nothing, the fields
 *   stay ABSENT — never guessed, never defaulted. The ADAPTER's own
 *   identity (id/label/version) is our code's and always known.
 * - OUTPUT IS THE ENGINE'S OWN: the translation text is the binary's
 *   stdout, trimmed of its trailing newline ONLY — parsed from the
 *   documented one-shot CLI shape
 *   `argos-translate --source-lang <src> --target-lang <tgt> <text>`,
 *   which prints the translated text to stdout. An engine that prints
 *   NOTHING is a failed run (typed engine-failed), never an empty
 *   translation; anything the engine prints IS its answer (the engine
 *   owns its own output format — we never re-interpret it).
 * - LOCAL ONLY: the only I/O is the child process on THIS machine; no
 *   network, no model downloads, no provider reads — ever.
 * - CANCELLATION: the signal is honoured at the boundary (checked before
 *   the child is spawned) and mid-run (the child process is KILLED when
 *   the signal aborts; the run rejects with the typed common/cancelled
 *   error). stdout/stderr are parsed ONLY after the process exits.
 * - The spawn seam is injectable (`spawnImpl`, default node:child_process
 *   spawn) so tests replay canned child behaviour WITHOUT any process I/O;
 *   the default is the only place a real binary runs. The environment is
 *   injected too (`processEnv`, default node:process env) so discovery is
 *   fully deterministic under test.
 */
import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import { accessSync, constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TranslationEngineDescriptor,
  TranslationEngineOptions,
  TranslationEnginePort,
  TranslationEngineProgress,
  TranslationRequest,
  TranslationResult,
} from "webflix-contracts";

/** The adapter's identity — OUR code's, always known. */
export const ARGOS_LOCAL_TRANSLATION_ENGINE_ID = "webflix.argos-local-translation";
export const ARGOS_LOCAL_TRANSLATION_ENGINE_VERSION = "0.1.0";

/** The recovery hint surfaced with the honest engine-unavailable state. */
export const ARGOS_RECOVERY_HINT = "install argos-translate and set WEBFLIX_ARGOS_BIN";

/**
 * Binary names an Argos-class install may carry: the argos-translate
 * package's one-shot CLI (`argos-translate`) and the short alias some
 * distributions ship (`argos`).
 */
export const ARGOS_BINARY_NAMES: readonly string[] = ["argos-translate", "argos"];

/** Directory roots searched AFTER the override and PATH (HOME resolved per call). */
const ARGOS_STANDARD_LOCATION_TEMPLATES: readonly string[] = [
  "/usr/local/bin",
  "/usr/bin",
  "/opt/homebrew/bin",
  "${HOME}/.local/bin",
  "${HOME}/bin",
];

/** The descriptor this adapter exposes (lineage honestly absent until read from a run). */
export const ARGOS_LOCAL_TRANSLATION_ENGINE_DESCRIPTOR: TranslationEngineDescriptor = {
  id: ARGOS_LOCAL_TRANSLATION_ENGINE_ID,
  label: "Argos-class translation (local)",
  version: ARGOS_LOCAL_TRANSLATION_ENGINE_VERSION,
  licenseNote:
    "Argos Translate is MIT-family licensed; its language models carry their own licenses",
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
  readonly WEBFLIX_ARGOS_BIN?: string;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * The binary path this adapter would run, or null when NO Argos-class
 * binary is discoverable on this machine. Search order (first hit wins):
 * 1. WEBFLIX_ARGOS_BIN (an absolute executable path, or a bare name
 *    resolved on PATH);
 * 2. PATH lookup for each candidate binary name;
 * 3. standard install locations (HOME-templated) for each candidate name.
 * Discovery is a pure function of (env, existsOnDisk) — deterministic and
 * side-effect-free beyond the injected probe.
 */
export function discoverArgosBinary(
  processEnv: EngineProcessEnv = nodeProcessEnv,
  existsOnDisk: (path: string) => boolean = pathExists,
): string | null {
  // 1. The explicit override: an absolute executable path wins as-is; a
  //    bare name falls through to PATH resolution.
  const override = processEnv.WEBFLIX_ARGOS_BIN;
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
  for (const name of ARGOS_BINARY_NAMES) {
    const hit = resolveOnPath(name, processEnv.PATH ?? "", existsOnDisk);
    if (hit !== null) return hit;
  }
  // 3. Standard locations per candidate name.
  for (const directory of standardLocations(processEnv)) {
    for (const name of ARGOS_BINARY_NAMES) {
      const candidate = join(directory, name);
      if (existsOnDisk(candidate)) return candidate;
    }
  }
  return null;
}

/** Standard install locations with HOME resolved (unresolved when HOME absent). */
function standardLocations(processEnv: EngineProcessEnv): readonly string[] {
  const home = processEnv.HOME;
  return ARGOS_STANDARD_LOCATION_TEMPLATES.map((template) =>
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
  get WEBFLIX_ARGOS_BIN(): string | undefined {
    return process.env.WEBFLIX_ARGOS_BIN;
  },
};

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface ArgosClassLocalTranslationEngineOptions {
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

export class ArgosClassLocalTranslationEngine implements TranslationEnginePort {
  readonly descriptor: TranslationEngineDescriptor;
  private readonly spawnEngine: SpawnEngineBinary;
  private readonly processEnv: EngineProcessEnv;
  private readonly existsOnDisk: (path: string) => boolean;
  /** The discovered binary for THIS instance (null = honestly absent). */
  private readonly binaryPath: string | null;

  constructor(options: ArgosClassLocalTranslationEngineOptions = {}) {
    this.descriptor = ARGOS_LOCAL_TRANSLATION_ENGINE_DESCRIPTOR;
    this.spawnEngine = options.spawnImpl ?? defaultSpawnEngineBinary;
    this.processEnv = options.processEnv ?? nodeProcessEnv;
    this.existsOnDisk = options.existsOnDisk ?? pathExists;
    this.binaryPath = discoverArgosBinary(this.processEnv, this.existsOnDisk);
  }

  /** The honest availability fact: the discovered path, or null (with the hint). */
  availability(): { available: boolean; binaryPath: string | null; recoveryHint: string } {
    return {
      available: this.binaryPath !== null,
      binaryPath: this.binaryPath,
      recoveryHint: ARGOS_RECOVERY_HINT,
    };
  }

  async translate(
    request: TranslationRequest,
    options?: TranslationEngineOptions,
  ): Promise<TranslationResult> {
    // 1. Honest availability: no binary on this machine => the typed
    //    engine-unavailable error, surfaced with the recovery hint.
    if (this.binaryPath === null) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTranslationEngineUnavailable,
        reason: `no Argos-class binary found on this machine (searched WEBFLIX_ARGOS_BIN, PATH for ${ARGOS_BINARY_NAMES.join(", ")}, and standard locations) — ${ARGOS_RECOVERY_HINT}`,
        retryable: false,
        context: { recoveryHint: ARGOS_RECOVERY_HINT },
      });
    }
    // 2. Boundary cancellation: never spawn an already-cancelled run.
    if (options?.signal?.aborted === true) {
      throw cancellationError("argos translation cancelled before the binary was spawned");
    }

    // 3. Spawn the LOCAL binary. Args follow the argos-translate one-shot
    //    CLI shape: --source-lang <tag> --target-lang <tag> <text>. No
    //    network exists in the engine itself (translation is local).
    const args: string[] = [
      "--source-lang",
      request.sourceLanguageTag,
      "--target-lang",
      request.targetLanguageTag,
      request.text,
    ];
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
              code: ErrorCode.IntelligenceTranslationEngineFailed,
              reason: `the argos binary could not be executed: ${err.message}`,
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
      throw cancellationError("argos translation cancelled — the binary was terminated mid-run");
    }
    if (exit.code !== 0) {
      const stderrText = concatenate(stderrChunks).trim();
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTranslationEngineFailed,
        reason: `the argos binary exited with code ${exit.code}${stderrText.length > 0 ? `: ${firstLine(stderrText)}` : ""}`,
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, exitCode: exit.code },
      });
    }

    // The run is the single honest work unit (a spawn-based CLI engine):
    // one progress tick after exit, totals known exactly.
    options?.onProgress?.({ completedUnits: 1, totalUnits: 1 } satisfies TranslationEngineProgress);

    // 6. The translation IS the engine's own stdout (trailing whitespace
    //    trimmed — the CLI's trailing newline). Empty output is a FAILED
    //    run, never an empty success.
    const stdoutText = concatenate(stdoutChunks);
    const translatedText = stdoutText.trim();
    if (translatedText.length === 0) {
      const stderrText = concatenate(stderrChunks).trim();
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTranslationEngineFailed,
        reason: `the argos binary printed no translation${stderrText.length > 0 ? ` (stderr: ${firstLine(stderrText)})` : ""}`,
        retryable: false,
        context: { binaryPath: this.binaryPath ?? undefined, exitCode: exit.code },
      });
    }

    // 7. Lineage: only what the binary ITSELF printed on THIS run.
    const combinedOutput = `${stdoutText}\n${concatenate(stderrChunks)}`;
    const engineVersion = matchFirst(combinedOutput, ARGOS_VERSION_RE);
    const modelLineage = matchFirst(combinedOutput, ARGOS_MODEL_RE);
    return {
      translatedText,
      ...(engineVersion !== null ? { engineVersion } : {}),
      ...(modelLineage !== null ? { modelLineage } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (conservative; the binary's own output is the only source)
// ---------------------------------------------------------------------------

/**
 * Argos-class version banner lines. Two documented shapes:
 * "argos-translate 1.9.6" (pip package style — a bare version after the
 * name) and "argos_translate: version=1.9.6" / "argos-translate version
 * 1.9.6" (explicit word). The alternation is ordered so the explicit
 * "version" marker wins when present, and the bare-number branch requires
 * the digit DIRECTLY after the name + whitespace — "argos-translate
 * loaded 2 models" does NOT match (conservative, never a false lineage).
 */
const ARGOS_VERSION_RE =
  /argos[-_ ]?translate(?:[^\n]{0,40}?version\s*[:=v\s]*|[ \t]+v?)([0-9][0-9a-zA-Z.-]*)/i;
/**
 * Model-load lines, e.g. "loading translation model 'en→es'" or
 * "loading model from 'models/en_es'". QUOTED values only — an unquoted
 * mention of the word "model" is not a lineage fact (absent stays absent).
 */
const ARGOS_MODEL_RE = /loading (?:translation )?model[^\n]{0,60}?['"]([^'"\n]{1,120})['"]/i;

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
