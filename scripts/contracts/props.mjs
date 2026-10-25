// Every component an adapter exports, from any of its package's entries,
// has a compile-time check of its props (packages/react/test/props.types.tsx,
// packages/vue/test/props.types.ts, packages/svelte/test/props.ts): the
// checks import it from the module that exports it and compare
// `typeof <component>`'s props with what the engine's function takes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Each adapter's file of checks, in its package. */
export const CHECKS = {
  react: "test/props.types.tsx",
  vue: "test/props.types.ts",
  svelte: "test/props.ts",
};

/** The source modules of a package's entries (its exports' keys: ".", "./layout", ...), from its package.json. */
export function entriesOf(root, adapter) {
  const directory = join(root, "packages", adapter);
  const { exports } = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  return Object.keys(exports)
    .filter((key) => key !== "./package.json")
    .map((key) => {
      const name = key === "." ? "index" : key.slice(2);
      const source = [".ts", ".tsx"].map((extension) => `src/${name}${extension}`);
      const found = source.find((file) => existsSync(join(directory, file)));
      if (!found) throw new Error(`contracts: no source for ${adapter}'s entry ${key}`);
      return found;
    });
}

/** The components a module exports: its exported values whose names are capitalized. */
export function exportedComponents(source) {
  const names = new Set();
  for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g))
    for (const specifier of list.split(",").map((s) => s.trim())) {
      if (!specifier || specifier.startsWith("type ")) continue;
      names.add(specifier.split(/\s+as\s+/).at(-1));
    }
  for (const [, name] of source.matchAll(/export\s+(?:const|function)\s+(\w+)/g)) names.add(name);
  return [...names].filter((name) => /^[A-Z]/.test(name)).sort();
}

/** What a file of checks imports, by module (without its extension): `{ local: exported }`. */
function importsOf(checks) {
  const imports = {};
  for (const [, list, from] of checks.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g,
  )) {
    const module = from.replace(/\.(t|j)sx?$/, "");
    for (const specifier of list.split(",").map((s) => s.trim().replace(/^type\s+/, ""))) {
      if (!specifier) continue;
      const [exported, local = exported] = specifier.split(/\s+as\s+/);
      imports[module] ??= {};
      imports[module][local] = exported;
    }
  }
  return imports;
}

/**
 * Errors for the components of `entries` (`{ module: source }`, modules as
 * `src/layout.tsx`) the checks (`checks`, the text of `file`) do not
 * compare: each must be imported from its module and written as `typeof`.
 */
export function uncheckedComponents(file, checks, entries) {
  const imports = importsOf(checks);
  const errors = [];
  for (const [module, source] of Object.entries(entries)) {
    const imported = imports[`../${module.replace(/\.(t|j)sx?$/, "")}`] ?? {};
    for (const component of exportedComponents(source)) {
      const local = Object.keys(imported).find((name) => imported[name] === component);
      if (!local || !new RegExp(`typeof ${local}\\b`).test(checks))
        errors.push(
          `${file}: no check of ${component} from ${module}; import it from there and compare its props as \`typeof ${local ?? component}\``,
        );
    }
  }
  return errors;
}

/** Errors for every adapter's components without a check. */
export function checkPropChecks(root) {
  return Object.entries(CHECKS).flatMap(([adapter, file]) => {
    const directory = join(root, "packages", adapter);
    const entries = Object.fromEntries(
      entriesOf(root, adapter).map((module) => [
        module,
        readFileSync(join(directory, module), "utf8"),
      ]),
    );
    const checks = readFileSync(join(directory, file), "utf8");
    return uncheckedComponents(`packages/${adapter}/${file}`, checks, entries);
  });
}
