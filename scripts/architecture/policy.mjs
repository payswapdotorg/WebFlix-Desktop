import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { parse as parseYaml } from "yaml";

// Violation construction (P5-CONTRACTS: moved here from index.mjs as the
// single source of truth so the forbidden-imports rule module shares the
// exact fingerprint/violation shape the report pipeline consumes).
export function fingerprint(rule, file, detail = "") {
  return createHash("sha256").update(`${rule}\0${file}\0${detail}`).digest("hex").slice(0, 16);
}

export function violation({ rule, file, detail, message, module, global = false }) {
  return {
    rule,
    file: posix(file),
    module: module?.id ?? null,
    detail,
    message,
    fingerprint: fingerprint(rule, posix(file), detail),
    global,
  };
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function posix(value) {
  return value.split(path.sep).join("/");
}

function isSourceFile(file) {
  return SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

async function walk(root, files) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (["node_modules", "dist", "out", "coverage", ".git"].includes(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(target, files);
    else if (entry.isFile() && isSourceFile(target)) files.push(target);
  }
}

function validatePolicy(raw, cwd) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.modules)) {
    throw new Error("architecture-policy.yaml 必须包含 version: 1 和 modules 数组");
  }
  const ids = new Set();
  const modules = raw.modules.map((module) => {
    if (!module?.id || ids.has(module.id))
      throw new Error(`模块 id 重复或为空: ${module?.id ?? ""}`);
    ids.add(module.id);
    if (!Array.isArray(module.roots) || module.roots.length === 0) {
      throw new Error(`模块 ${module.id} 必须声明 roots`);
    }
    return {
      id: module.id,
      roots: module.roots.map((root) => path.resolve(cwd, root)),
      managed: module.managed === true,
      requires: [...new Set(module.requires ?? [])],
      publicEntrypoints: (module.publicEntrypoints ?? []).map((entry) => posix(entry)),
      layers: module.layers ?? {},
      layerOrder: module.layerOrder ?? Object.keys(module.layers ?? {}),
      owner: module.owner ?? null,
    };
  });
  const moduleIds = new Set(modules.map((module) => module.id));
  for (const module of modules) {
    for (const dependency of module.requires) {
      if (!moduleIds.has(dependency))
        throw new Error(`模块 ${module.id} 依赖未知模块 ${dependency}`);
    }
  }
  const global = {
    maxFileLines: raw.global?.maxFileLines ?? 400,
    maxContractLines: raw.global?.maxContractLines ?? 300,
    forbidCycles: raw.global?.forbidCycles !== false,
    forbidDeepImports: raw.global?.forbidDeepImports !== false,
    managedOnly: raw.global?.managedOnly !== false,
    maxPublicMethods: raw.global?.maxPublicMethods ?? 12,
  };
  const exceptions = (raw.exceptions ?? []).map((exception) => ({
    ...exception,
    paths: exception.paths ?? [],
  }));
  // forbiddenImports (P5-CONTRACTS): path-glob -> specifier-glob -> symbol
  // rules that pin import separation the package-level `requires` edges
  // cannot express (e.g. "the organic ranking path never imports the Ad
  // Center shapes" — a symbol-level rule over the contracts entrypoint).
  // `symbols` null/absent = ANY import from a matching specifier is
  // forbidden; otherwise at least one imported binding must be listed.
  // These rules are evaluated for EVERY discovered file (managed or not):
  // the webflix modules are managed: false by the 2026-10-10 correction,
  // so a managed-only guard would silently disable the separation pin.
  const forbiddenIds = new Set();
  const forbiddenImports = (raw.forbiddenImports ?? []).map((rule) => {
    if (!rule?.id || forbiddenIds.has(rule.id)) {
      throw new Error(`forbiddenImports 规则 id 重复或为空: ${rule?.id ?? ""}`);
    }
    forbiddenIds.add(rule.id);
    if (!Array.isArray(rule.from) || rule.from.length === 0) {
      throw new Error(`forbiddenImports 规则 ${rule.id} 必须声明 from 路径模式`);
    }
    if (!Array.isArray(rule.specifier) || rule.specifier.length === 0) {
      throw new Error(`forbiddenImports 规则 ${rule.id} 必须声明 specifier 模式`);
    }
    const symbols = rule.symbols ?? null;
    if (symbols !== null && (!Array.isArray(symbols) || symbols.length === 0)) {
      throw new Error(`forbiddenImports 规则 ${rule.id} 的 symbols 必须是非空数组或省略`);
    }
    return {
      id: rule.id,
      description: rule.description ?? "",
      from: [...new Set(rule.from)].map(posix),
      specifier: [...new Set(rule.specifier)],
      symbols: symbols === null ? null : [...new Set(symbols)],
    };
  });
  return { version: 1, modules, global, exceptions, forbiddenImports };
}

export function layerForFile(file, module) {
  const matches = module.roots
    .flatMap((root) =>
      Object.entries(module.layers).map(([name, directory]) => ({
        name,
        directory: path.resolve(root, directory),
      })),
    )
    .filter(({ directory }) => file === directory || file.startsWith(`${directory}${path.sep}`))
    .sort((a, b) => b.directory.length - a.directory.length);
  return matches[0]?.name ?? null;
}

export function publicEntrypointMatches(target, targetModule, cwd) {
  return targetModule.publicEntrypoints.some((entry) => {
    const candidates = [
      path.resolve(cwd, entry),
      ...targetModule.roots.map((root) => path.resolve(root, entry)),
    ];
    return candidates.includes(target);
  });
}

export function manifestRequires(source) {
  const match = source.match(/requires\s*:\s*\[([^\]]*)\]/s);
  if (!match) return null;
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

export function countPublicMethods(source) {
  const sourceFile = ts.createSourceFile("contract.ts", source, ts.ScriptTarget.Latest, true);
  let count = 0;
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      for (const member of node.members) {
        if (
          ts.isMethodSignature(member) ||
          ts.isMethodDeclaration(member) ||
          ts.isCallSignatureDeclaration(member)
        )
          count += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

export async function loadPolicy(cwd = process.cwd()) {
  const filename = path.join(cwd, "architecture-policy.yaml");
  const content = await fs.readFile(filename, "utf8");
  return validatePolicy(parseYaml(content), cwd);
}

export function moduleForFile(file, policy) {
  const candidates = policy.modules
    .filter((module) =>
      module.roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`)),
    )
    .sort(
      (a, b) =>
        Math.max(...b.roots.map((root) => root.length)) -
        Math.max(...a.roots.map((root) => root.length)),
    );
  return candidates[0] ?? null;
}

export async function discoverFiles(policy) {
  const files = [];
  for (const module of policy.modules) {
    for (const root of module.roots) await walk(root, files);
  }
  return [...new Set(files)].sort();
}

export function resolveImport(from, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  let base = path.resolve(path.dirname(from), specifier);
  if (SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))) {
    base = base.slice(0, base.lastIndexOf("."));
  }
  const candidates = [];
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
  for (const extension of SOURCE_EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

export function importsOf(file, source) {
  return importDeclarationsOf(file, source).map((declaration) => declaration.specifier);
}

/**
 * Import/export declarations with their IMPORTED BINDING NAMES (the
 * separation rules are symbol-level: which names a file pulls from which
 * specifier). Named imports/export re-exports contribute their names
 * (`propertyName` when aliased — the name ON the target module); a
 * namespace import (`import * as x`) contributes "*" (any symbol could be
 * reached through it); a default import contributes "default"; a
 * star re-export (`export * from`) contributes "*". Type-only imports
 * (`import type { X }`) are ordinary declarations here — a type entering
 * the forbidden path is as much a separation violation as a value.
 */
export function importDeclarationsOf(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations = [];
  function bindingsOfImportClause(clause) {
    if (!clause) return [];
    if (clause.name) return ["default"];
    const named = clause.namedBindings;
    if (!named) return [];
    if (ts.isNamespaceImport(named)) return ["*"];
    return named.elements.map((element) =>
      element.propertyName ? element.propertyName.text : element.name.text,
    );
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      let bindings;
      if (ts.isImportDeclaration(node)) {
        bindings = bindingsOfImportClause(node.importClause);
      } else {
        const clause = node.exportClause;
        bindings =
          clause && ts.isNamedExports(clause)
            ? clause.elements.map((element) =>
                element.propertyName ? element.propertyName.text : element.name.text,
              )
            : ["*"];
      }
      declarations.push({ specifier: node.moduleSpecifier.text, bindings });
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteral(node.moduleReference.expression))
        declarations.push({ specifier: node.moduleReference.expression.text, bindings: ["*"] });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return declarations;
}

/**
 * Glob matcher for forbiddenImport patterns: `**` matches any characters
 * (including path separators), `*` matches any characters EXCEPT the
 * path separator; everything else matches literally.
 */
export function globMatches(pattern, value) {
  let regex = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i];
    if (character === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 1;
      } else {
        regex += "[^/]*";
      }
    } else {
      regex += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${regex}$`).test(value);
}

export function isException(policy, rule, file, cwd) {
  const relative = posix(path.relative(cwd, file));
  return policy.exceptions.some(
    (exception) =>
      exception.rule === rule &&
      exception.paths.some(
        (pattern) => relative === pattern || relative.startsWith(pattern.replace(/\*\*$/, "")),
      ),
  );
}
