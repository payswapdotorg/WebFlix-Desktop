/**
 * The P5-CONTRACTS ads-separation FIRING TEST fixture builder.
 *
 * Test-fixture code (NOT engine code): constructs a THROWAWAY directory
 * tree that mimics the repo layout the architecture policy's module
 * roots expect, copies the REAL architecture-policy.yaml into it, and
 * plants the deliberate bad imports (plus negative controls) the firing
 * test in packages/webflix-domain/src/tests/ads-separation-rule.test.ts
 * asserts on. Nothing here touches the real tree. The node-dependent
 * filesystem work lives HERE (in the granted architecture-check lane)
 * so the webflix-domain package stays node-free (`types: []`).
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The real repo root (this module lives at scripts/architecture/). */
export const REPO_ROOT = path.resolve(HERE, "../..");

/** The deliberate bad imports + negative controls (relpath -> source). */
const FIXTURE_FILES = {
  // BAD: a named VALUE import of an ads symbol into a ranking use case.
  "packages/webflix-application/src/built-in-ranker.ts":
    'import { AdRecordSchema } from "webflix-contracts";\nexport const bad = AdRecordSchema;\n',
  // BAD: a NAMESPACE import — any symbol could be reached through it.
  "packages/webflix-application/src/set-objectives.ts":
    'import * as contracts from "webflix-contracts";\nexport const laundered = contracts;\n',
  // BAD: a TYPE-ONLY ads import (a type entering the path is a violation too).
  "packages/webflix-application/src/mi-text-intelligence.ts":
    'import type { AdRecord } from "webflix-contracts";\nexport type Peek = AdRecord | null;\n',
  // BAD (reverse rule): the ads module reaching an intelligence sibling.
  "packages/webflix-contracts/src/ads.ts":
    'import { RankingResultSchema } from "./intelligence.js";\nexport const bad = RankingResultSchema;\n',
  // NEGATIVE CONTROL: non-ads symbols from the same entrypoint — must NOT fire.
  "packages/webflix-application/src/generate-recommendations.ts":
    'import { JobDescriptorSchema, ErrorCode } from "webflix-contracts";\nexport const ok = [JobDescriptorSchema, ErrorCode];\n',
  // NEGATIVE CONTROL: the ranking domain invariants file importing ranking symbols.
  "packages/webflix-domain/src/intelligence.ts":
    'import { ErrorCode, RankingResultSchema } from "webflix-contracts";\nexport const ok = [ErrorCode, RankingResultSchema];\n',
};

/**
 * Creates the fixture tree in a fresh temp directory and returns its
 * root path. The tree carries the REAL policy (copied verbatim) so the
 * firing test proves the shipped configuration fires, not a synthetic
 * stand-in.
 */
export async function createFixtureTree() {
  const root = await fs.mkdtemp(path.join(tmpdir(), "p5c-arch-"));
  const policy = await fs.readFile(path.join(REPO_ROOT, "architecture-policy.yaml"), "utf8");
  await fs.writeFile(path.join(root, "architecture-policy.yaml"), policy, "utf8");
  for (const [relative, source] of Object.entries(FIXTURE_FILES)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source, "utf8");
  }
  return root;
}

/** Removes a fixture tree (idempotent; safe to call twice). */
export async function removeFixtureTree(root) {
  await fs.rm(root, { recursive: true, force: true });
}
