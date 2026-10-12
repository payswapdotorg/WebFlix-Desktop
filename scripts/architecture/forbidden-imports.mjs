/**
 * The forbiddenImports rule pass (P5-CONTRACTS): path-glob -> specifier-
 * glob -> symbol import-separation rules, evaluated for EVERY discovered
 * file (managed or not — the webflix modules are managed: false by the
 * 2026-10-10 correction, so a managed-only guard would silently disable
 * the ads-separation pin the Ad Center depends on). A violation fires
 * when a from-matching file imports a matching specifier AND (the rule
 * lists no symbols OR at least one imported binding is listed OR the
 * import is namespace/star-shaped — any symbol could be reached through
 * it, so a symbol-scoped rule treats it as a hit rather than let it
 * launder past the enumeration). Side-effect imports (no bindings) are
 * not attributed to any symbol and are skipped — an honest limit of
 * binding-level attribution, documented here.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { globMatches, importDeclarationsOf, posix, violation } from "./policy.mjs";

/**
 * Returns the forbidden-import violations for the discovered `files`
 * under `cwd` (absolute paths) against the loaded `policy`, using
 * `modulesByFile` for violation module attribution.
 */
export async function checkForbiddenImports({ cwd, files, policy, modulesByFile }) {
  const violations = [];
  for (const file of files) {
    const relative = posix(path.relative(cwd, file));
    const applicable = policy.forbiddenImports.filter((rule) =>
      rule.from.some((pattern) => globMatches(pattern, relative)),
    );
    if (applicable.length === 0) continue;
    const source = await fs.readFile(file, "utf8");
    for (const declaration of importDeclarationsOf(file, source)) {
      if (declaration.bindings.length === 0) continue;
      for (const rule of applicable) {
        if (!rule.specifier.some((pattern) => globMatches(pattern, declaration.specifier))) {
          continue;
        }
        const matched = declaration.bindings.filter(
          (binding) => rule.symbols === null || rule.symbols.includes(binding) || binding === "*",
        );
        if (matched.length === 0) continue;
        violations.push(
          violation({
            rule: "forbidden-import",
            file,
            detail: `${rule.id}: ${declaration.specifier} (${matched.join(", ")})`,
            module: modulesByFile.get(file),
            message: `违反导入隔离规则 ${rule.id}：不能从 ${declaration.specifier} 导入 ${matched.join("、")}`,
          }),
        );
      }
    }
  }
  return violations;
}
