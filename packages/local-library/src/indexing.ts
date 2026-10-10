import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { IndexCancelledError, PathSafetyError } from "./errors";
import { fingerprintFor } from "./fingerprint";
import { isInside, titleFromPath } from "./paths";
import type { IndexedFileInfo, LibraryEntryKind } from "./types";

export const DEFAULT_MEDIA_EXTENSIONS = [
  ".mp4",
  ".m4v",
  ".mkv",
  ".mov",
  ".webm",
  ".avi",
  ".mpg",
  ".mpeg",
  ".ts",
];

export interface IndexOptions {
  extensions?: readonly string[];
  kind?: LibraryEntryKind;
  signal?: AbortSignal;
  onProgress?: (scanned: number) => void;
}

export function hasMediaExtension(fileName: string, extensions: ReadonlySet<string>): boolean {
  const lower = fileName.toLowerCase();
  for (const ext of extensions) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new IndexCancelledError("indexing cancelled by AbortSignal");
  }
}

function buildEntry(
  realPath: string,
  sizeBytes: number,
  mtimeMs: number,
  kind: LibraryEntryKind,
): IndexedFileInfo {
  const size = Math.max(0, Math.floor(sizeBytes));
  const mtime = Math.floor(mtimeMs);
  return {
    path: realPath,
    title: titleFromPath(realPath),
    kind,
    sizeBytes: size,
    mtimeMs: mtime,
    fingerprint: fingerprintFor(realPath, size, mtime),
  };
}

/**
 * Path-safe file/folder indexer.
 *
 * - Only ever returns paths that resolve (symlinks included) INSIDE the real
 *   index root; directory symlinks are never followed, escaping symlinks are
 *   skipped, so there are no traversal escapes and no cycles.
 * - Fingerprints are sha-256 of (path, size, mtime) — media bytes are never read.
 * - Cancellable between every directory entry via AbortSignal.
 */
export function indexPath(root: string, options: IndexOptions = {}): IndexedFileInfo[] {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) {
    throw new PathSafetyError(`unsafe index root: ${JSON.stringify(root)}`);
  }
  const rootReal = realpathSync(resolve(root)); // throws if the root does not exist
  const extensions = new Set(
    (options.extensions ?? DEFAULT_MEDIA_EXTENSIONS).map((ext) => ext.toLowerCase()),
  );
  const kind = options.kind ?? "other";
  const results: IndexedFileInfo[] = [];
  let scanned = 0;

  const pending: string[] = [rootReal];
  while (pending.length > 0) {
    throwIfAborted(options.signal);
    const current = pending.pop() as string;
    const currentStat = statSync(current, { throwIfNoEntry: false });
    if (!currentStat) {
      continue;
    }
    if (currentStat.isFile()) {
      scanned += 1;
      options.onProgress?.(scanned);
      throwIfAborted(options.signal);
      if (hasMediaExtension(basename(current), extensions)) {
        results.push(buildEntry(current, currentStat.size, currentStat.mtimeMs, kind));
      }
      continue;
    }

    let dirents;
    try {
      dirents = readdirSync(current, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip, stay path-safe
    }
    for (const dirent of dirents) {
      throwIfAborted(options.signal);
      const full = join(current, dirent.name);
      if (dirent.isSymbolicLink()) {
        let targetReal: string;
        try {
          targetReal = realpathSync(full);
        } catch {
          continue;
        }
        if (!isInside(targetReal, rootReal)) {
          continue; // symlink escaping the root → never indexed
        }
        const targetStat = statSync(targetReal, { throwIfNoEntry: false });
        if (!targetStat) {
          continue;
        }
        scanned += 1;
        options.onProgress?.(scanned);
        throwIfAborted(options.signal);
        if (targetStat.isFile() && hasMediaExtension(dirent.name, extensions)) {
          results.push(buildEntry(targetReal, targetStat.size, targetStat.mtimeMs, kind));
        }
        continue; // never recurse into symlinked directories (no escape, no cycles)
      }
      if (dirent.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (dirent.isFile()) {
        const fileStat = statSync(full, { throwIfNoEntry: false });
        if (!fileStat) {
          continue;
        }
        let real: string;
        try {
          real = realpathSync(full);
        } catch {
          continue;
        }
        if (!isInside(real, rootReal)) {
          continue; // paranoia: keeps the "everything is inside root" invariant explicit
        }
        scanned += 1;
        options.onProgress?.(scanned);
        throwIfAborted(options.signal);
        if (hasMediaExtension(dirent.name, extensions)) {
          results.push(buildEntry(real, fileStat.size, fileStat.mtimeMs, kind));
        }
      }
    }
  }
  return results;
}
