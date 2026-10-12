/**
 * The ads-separation architecture rule's FIRING test (P5-CONTRACTS scope
 * row 2): a deliberate bad-import fixture proves the rule detects ad
 * symbols entering the organic ranking path — through the REAL checker
 * (scripts/architecture/index.mjs) over the REAL policy
 * (architecture-policy.yaml, copied verbatim into the fixture tree).
 *
 * The fixture tree itself is built by scripts/architecture/
 * ads-separation-fixture.mjs (the node-dependent filesystem work lives
 * in the granted architecture-check lane, keeping this package
 * node-free — its tsconfig deliberately declares `types: []`); the
 * checker and its utilities are plain .mjs tools imported untyped below
 * (the @ts-expect-error pairs below suppress exactly those untyped
 * module resolutions; the tsc gate still type-checks this file).
 *
 * What is proven, exactly:
 * - a named VALUE import of an ads symbol into a ranking use case fires;
 * - a TYPE-ONLY import fires identically (a type entering the forbidden
 *   path is as much a separation violation as a value);
 * - a NAMESPACE import fires (any symbol could be reached through it —
 *   the symbol enumeration cannot be laundered past with `import * as`);
 * - non-ads symbol imports (the negative controls) do NOT fire — the
 *   rule is symbol-scoped, not a blanket package ban;
 * - the reverse rule fires on the ads module importing an intelligence
 *   sibling;
 * - the clean REAL tree (the actual gate input) reports ZERO
 *   forbidden-import violations — the rule passes where it must and
 *   fires where it must.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type ArchitectureViolation = { rule: string; file: string; detail: string; message: string };
type ArchitectureResult = { violations: ArchitectureViolation[] };
type ImportDeclaration = { specifier: string; bindings: string[] };

let checkArchitecture: (input: { cwd: string }) => Promise<ArchitectureResult>;
let createFixtureTree: () => Promise<string>;
let removeFixtureTree: (root: string) => Promise<void>;
let repoRoot: string;
let globMatches: (pattern: string, value: string) => boolean;
let importDeclarationsOf: (file: string, source: string) => ImportDeclaration[];

beforeAll(async () => {
  // @ts-expect-error — untyped .mjs tool import (scripts/architecture)
  const engine = await import("../../../../scripts/architecture/index.mjs");
  checkArchitecture = engine.checkArchitecture;
  // @ts-expect-error — untyped .mjs fixture module (scripts/architecture)
  const fixture = await import("../../../../scripts/architecture/ads-separation-fixture.mjs");
  createFixtureTree = fixture.createFixtureTree;
  removeFixtureTree = fixture.removeFixtureTree;
  repoRoot = fixture.REPO_ROOT;
  // @ts-expect-error — untyped .mjs utility import (scripts/architecture)
  const policy = await import("../../../../scripts/architecture/policy.mjs");
  globMatches = policy.globMatches;
  importDeclarationsOf = policy.importDeclarationsOf;
});

const fixtureRoots: string[] = [];
afterAll(async () => {
  for (const root of fixtureRoots) await removeFixtureTree(root);
});

describe("architecture glob + import-binding utilities", () => {
  it("globMatches pins the mi-* pattern to the organic-path files", () => {
    expect(
      globMatches(
        "packages/webflix-application/src/mi-*.ts",
        "packages/webflix-application/src/mi-evaluate.ts",
      ),
    ).toBe(true);
    expect(
      globMatches(
        "packages/webflix-application/src/mi-*.ts",
        "packages/webflix-application/src/mi-text-intelligence.ts",
      ),
    ).toBe(true);
    expect(
      globMatches(
        "packages/webflix-application/src/mi-*.ts",
        "packages/webflix-application/src/built-in-ranker.ts",
      ),
    ).toBe(false);
    expect(
      globMatches(
        "packages/webflix-application/src/mi-*.ts",
        "packages/webflix-application/src/ads-claims.ts",
      ),
    ).toBe(false);
  });

  it("globMatches handles the deep ads-import pattern and the ads sibling pattern", () => {
    expect(
      globMatches("**/webflix-contracts/src/ads*.js", "../../webflix-contracts/src/ads.js"),
    ).toBe(true);
    expect(
      globMatches(
        "**/webflix-contracts/src/ads*.js",
        "../../webflix-contracts/src/ads-evidence.js",
      ),
    ).toBe(true);
    expect(
      globMatches(
        "**/webflix-contracts/src/ads*.js",
        "../../webflix-contracts/src/intelligence.js",
      ),
    ).toBe(false);
    expect(
      globMatches(
        "packages/webflix-contracts/src/ads*.ts",
        "packages/webflix-contracts/src/ads.ts",
      ),
    ).toBe(true);
    expect(
      globMatches(
        "packages/webflix-contracts/src/ads*.ts",
        "packages/webflix-contracts/src/ads-evidence.ts",
      ),
    ).toBe(true);
    expect(
      globMatches(
        "packages/webflix-contracts/src/ads*.ts",
        "packages/webflix-contracts/src/catalog.ts",
      ),
    ).toBe(false);
  });

  it("importDeclarationsOf extracts named, aliased, type-only, namespace and side-effect imports", () => {
    const declarations = importDeclarationsOf(
      "fixture.ts",
      [
        'import { AdRecordSchema, ErrorCode as Code } from "webflix-contracts";',
        'import type { AdRecord } from "webflix-contracts";',
        'import * as contracts from "webflix-contracts";',
        'import "./side-effect.js";',
        'import { parseOrThrow } from "webflix-domain";',
      ].join("\n"),
    );
    expect(declarations).toEqual([
      // An alias maps to the symbol ON THE TARGET module (ErrorCode), not the local name.
      { specifier: "webflix-contracts", bindings: ["AdRecordSchema", "ErrorCode"] },
      { specifier: "webflix-contracts", bindings: ["AdRecord"] },
      { specifier: "webflix-contracts", bindings: ["*"] },
      { specifier: "./side-effect.js", bindings: [] },
      { specifier: "webflix-domain", bindings: ["parseOrThrow"] },
    ]);
  });
});

describe("ads-separation architecture rule (the firing test)", () => {
  async function fixtureViolations(): Promise<ArchitectureViolation[]> {
    const root = await createFixtureTree();
    fixtureRoots.push(root);
    const result = await checkArchitecture({ cwd: root });
    return result.violations.filter((item) => item.rule === "forbidden-import");
  }

  it("fires on a named value import of an ads symbol into a ranking use case", async () => {
    const forbidden = await fixtureViolations();
    const hit = forbidden.find(
      (item) =>
        item.file.endsWith("built-in-ranker.ts") && item.detail.startsWith("ads-separation:"),
    );
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("webflix-contracts");
    expect(hit?.detail).toContain("AdRecordSchema");
    expect(hit?.message).toContain("ads-separation");
  });

  it("fires on a TYPE-ONLY ads import (a type entering the path is a violation too)", async () => {
    const forbidden = await fixtureViolations();
    expect(
      forbidden.some(
        (item) => item.file.endsWith("mi-text-intelligence.ts") && item.detail.includes("AdRecord"),
      ),
    ).toBe(true);
  });

  it("fires on a NAMESPACE import (the symbol list cannot be laundered past)", async () => {
    const forbidden = await fixtureViolations();
    expect(
      forbidden.some(
        (item) => item.file.endsWith("set-objectives.ts") && item.detail.includes("*"),
      ),
    ).toBe(true);
  });

  it("fires the reverse rule on the ads module importing an intelligence sibling", async () => {
    const forbidden = await fixtureViolations();
    const hit = forbidden.find(
      (item) =>
        item.file.endsWith("webflix-contracts/src/ads.ts") &&
        item.detail.startsWith("ads-separation-reverse:"),
    );
    expect(hit).toBeDefined();
    expect(hit?.detail).toContain("./intelligence.js");
  });

  it("does NOT fire on non-ads symbol imports (the negative controls)", async () => {
    const forbidden = await fixtureViolations();
    expect(forbidden.some((item) => item.file.endsWith("generate-recommendations.ts"))).toBe(false);
    expect(forbidden.some((item) => item.file.endsWith("webflix-domain/src/intelligence.ts"))).toBe(
      false,
    );
  });

  it("reports ZERO forbidden-import violations on the REAL clean tree", async () => {
    // The real gate input: the actual repo tree through the actual policy —
    // the same engine + policy `pnpm architecture:check` runs.
    const result = await checkArchitecture({ cwd: repoRoot });
    const forbidden = result.violations.filter((item) => item.rule === "forbidden-import");
    expect(forbidden).toEqual([]);
  });
});
