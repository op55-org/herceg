// What each surface offers, found in its code, for the check that every
// mark, mark function, Python method and helper, Express function, and
// adapter component is a row of the matrix (or listed as something else),
// and every row names what exists:
// - the spec's mark types and the engine's mark functions (those returning
//   a ChartMark), from TypeScript 7's compiler API;
// - Python's, from scripts/contracts/inventory.py through uv;
// - the adapters' components, from their index modules' exports.
// And for the API audit (api.mjs), the options each takes, with the string
// choices their types allow: `{ name: choices }`; for the adapters, their
// chart props, events, and Vue's bare attributes (their components' props
// are checked at compile time: props.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { API, SignatureKind, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import { SURFACES } from "./declarations.mjs";
import { exportedComponents } from "./props.mjs";

/**
 * The string literals a type allows, in its unions and its arrays' and
 * tuples' elements (recursive types once), with "*" where it takes any
 * string. A generic type (a field of a table's schema) allows what its
 * constraint does.
 */
function choicesOf(checker, type) {
  const found = new Set();
  const seen = new Set();
  const walk = (part) => {
    if (seen.has(part.id)) return;
    seen.add(part.id);
    if (part.flags & TypeFlags.Union) for (const member of part.getTypes()) walk(member);
    else if (part.flags & TypeFlags.StringLiteral)
      found.add(JSON.parse(checker.typeToString(part)));
    else if (part.flags & (TypeFlags.String | TypeFlags.TemplateLiteral)) found.add("*");
    // `string & {}`, as types that suggest names but take any string write it.
    else if (
      part.flags & TypeFlags.Intersection &&
      part.getTypes().some((t) => t.flags & TypeFlags.String)
    )
      found.add("*");
    else if (checker.isArrayType(part) || checker.isTupleType(part))
      for (const element of checker.getTypeArguments(part)) walk(element);
    else if (part.flags & (TypeFlags.Conditional | TypeFlags.TypeParameter)) {
      const constraint = checker.getBaseConstraintOfType(part);
      if (constraint) walk(constraint);
    }
  };
  walk(type);
  return [...found].sort();
}

const pick = (options, names) => Object.fromEntries(names.map((name) => [name, options[name]]));

/** `options` with `more`'s options added, the choices of those in both joined. */
function joined(options = {}, more = {}) {
  const all = { ...options };
  for (const [name, choices] of Object.entries(more))
    all[name] = [...new Set([...(Object.hasOwn(all, name) ? all[name] : []), ...choices])].sort();
  return all;
}

/**
 * The object types whose properties are a type's: each member of a union
 * or an intersection, and both branches of a conditional type (a
 * component's props, which differ with the table it is given).
 */
function shapesOf(type) {
  if (type.flags & (TypeFlags.Union | TypeFlags.Intersection))
    return type.getTypes().flatMap(shapesOf);
  if (type.flags & TypeFlags.Conditional)
    return [type.getTrueType(), type.getFalseType()].flatMap(shapesOf);
  return [type];
}

/** Per checker, what a function found of each type, by its id: the compiler's answers each cost a call. */
const remembered = new WeakMap();
function remember(checker, what, type, find) {
  if (!remembered.has(checker)) remembered.set(checker, new Map());
  const cache = remembered.get(checker);
  const key = `${what} ${type.id}`;
  if (!cache.has(key)) cache.set(key, find());
  return cache.get(key);
}

/** Choices two lists both allow, "*" being any string. */
const bothAllow = (a, b) =>
  a.includes("*") ? b : b.includes("*") ? a : a.filter((choice) => b.includes(choice));

/** The options of an intersection of `a` and `b`: each one's, with the choices both allow of those in both. */
function intersected(a, b) {
  const all = { ...a, ...b };
  for (const name of Object.keys(a))
    if (Object.hasOwn(b, name)) all[name] = bothAllow(a[name], b[name]);
  return all;
}

/**
 * The options of each alternative a type is, with their choices: of each
 * member of a union and each branch of a conditional type (a component's
 * props, which differ with the table it is given), an intersection's being
 * its members' intersected; objects of settings alone.
 */
function alternativesOf(checker, type) {
  return remember(checker, "alternatives", type, () => findAlternatives(checker, type));
}

function findAlternatives(checker, type) {
  const each = (types) => types.flatMap((part) => alternativesOf(checker, part));
  if (type.flags & TypeFlags.Union) return each(type.getTypes());
  if (type.flags & TypeFlags.Conditional) return each([type.getTrueType(), type.getFalseType()]);
  if (type.flags & TypeFlags.Intersection)
    return type
      .getTypes()
      .map((part) => alternativesOf(checker, part))
      .reduce((all, next) => all.flatMap((a) => next.map((b) => intersected(a, b))));
  if (!settingsObject(checker, type)) return [];
  const options = {};
  for (const property of checker.getPropertiesOfType(type))
    options[property.name] = choicesOf(checker, checker.getTypeOfSymbol(property));
  return [options];
}

/** A type's options and their choices, over its alternatives. */
function optionsOf(checker, type) {
  return alternativesOf(checker, type).reduce(joined, {});
}

/**
 * Settings (`{ options, nested, type, keyed }`) with `more`'s added: their
 * options' choices joined, option by option, the name of their type kept
 * where both have it, and keyed (held as a record's values) if either is.
 */
function joinedSettings(settings, more) {
  if (settings === undefined) return more;
  const nested = { ...settings.nested };
  for (const [option, held] of Object.entries(more.nested))
    nested[option] = joinedSettings(
      Object.hasOwn(nested, option) ? nested[option] : undefined,
      held,
    );
  const type = settings.type === more.type ? more.type : undefined;
  const keyed = settings.keyed || more.keyed ? { keyed: true } : {};
  return { options: joined(settings.options, more.options), nested, type, ...keyed };
}

/** `nested` (`{ option: settings }`) with `more`'s added. */
function joinedNested(nested = {}, more = {}) {
  return joinedSettings({ options: {}, nested }, { options: {}, nested: more }).nested;
}

/**
 * Whether a type is an instance of a class (a Facet, a Navigator) or a
 * library's own (Date, a typed array): what an option takes beside its
 * settings, not settings.
 */
function instanceType(type) {
  const symbol = type.getSymbol();
  if (!symbol || symbol.name === "__type") return false;
  return (
    (symbol.flags & SymbolFlags.Class) !== 0 ||
    (symbol.declarations.length > 0 &&
      symbol.declarations.every(({ path }) => path.includes("/node_modules/")))
  );
}

/** Whether a type is an object of settings: not an array, a function, or an instance. */
function settingsObject(checker, type) {
  return (
    (type.flags & TypeFlags.Object) !== 0 &&
    !checker.isArrayType(type) &&
    !checker.isTupleType(type) &&
    checker.getSignaturesOfType(type, SignatureKind.Call).length === 0 &&
    !instanceType(type)
  );
}

/**
 * The types whose settings an option's value holds: itself, or the
 * elements of its lists and the values of its records (`guides`,
 * `scales`), through unions; recursive types (expressions) once.
 */
function heldTypes(checker, type, seen = new Set()) {
  if (seen.has(type.id)) return [];
  seen.add(type.id);
  const each = (types) => types.flatMap((part) => heldTypes(checker, part, seen));
  if (type.flags & TypeFlags.Union) return each(type.getTypes());
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return each(checker.getTypeArguments(type));
  const values = recordValues(checker, type);
  return values ? each(values) : [type];
}

/**
 * The values of a record of settings by name, an object with an index
 * signature (`scales`, with x and y named in it); none for other types.
 */
function recordValues(checker, type) {
  if (!(type.flags & TypeFlags.Object)) return undefined;
  const values = checker.getIndexInfosOfType(type).map(({ valueType }) => valueType);
  if (values.length === 0) return undefined;
  return [...values, ...checker.getPropertiesOfType(type).map((p) => checker.getTypeOfSymbol(p))];
}

/** Whether a value holds settings by name, as a record's values (a list's are not by name). */
function keyedOf(checker, type) {
  if (type.flags & TypeFlags.Union) return type.getTypes().some((part) => keyedOf(checker, part));
  if (checker.isArrayType(type) || checker.isTupleType(type)) return false;
  return recordValues(checker, type) !== undefined;
}

/** A type's name, an interface's or an alias's (with its type arguments); none for an object literal's. */
function nameOf(checker, type) {
  const alias = type.getAliasSymbol();
  const symbol = alias ?? type.getSymbol();
  // A library's (Pick<Style, ...>) names what is made of it, not it.
  const library = symbol?.declarations.every(({ path }) => path.includes("/node_modules/"));
  if (!symbol || symbol.name.startsWith("__") || library) return undefined;
  const parts = alias ? type.getAliasTypeArguments() : [];
  const given = parts.map((part) => checker.typeToString(part)).join(", ");
  return parts.length > 0 ? `${symbol.name}<${given}>` : symbol.name;
}

/**
 * The name of the settings an option's value holds, as its type declares
 * them: the names of the types holding them (an alias standing for its
 * members, `TicksSpec`), joined, where each has one.
 */
function heldName(checker, type) {
  const names = heldNames(checker, type, new Set());
  return names.length > 0 && names.every(Boolean)
    ? [...new Set(names)].sort().join("|")
    : undefined;
}

function heldNames(checker, type, seen) {
  if (seen.has(type.id)) return [];
  seen.add(type.id);
  const holds = () => Object.keys(optionsOf(checker, type)).length > 0;
  const name = nameOf(checker, type);
  if (name) return holds() ? [name] : [];
  const each = (types) => types.flatMap((part) => heldNames(checker, part, seen));
  if (type.flags & TypeFlags.Union) return each(type.getTypes());
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return each(checker.getTypeArguments(type));
  const values = recordValues(checker, type);
  if (values) return each(values);
  return holds() ? [undefined] : [];
}

/**
 * A type's settings: its options with their choices (`options`), and of
 * each option whose value holds settings of its own, those (`nested`), at
 * any depth, named (`type`) where their types are, and `keyed` where an
 * option holds them by name (a record's values); a type met again inside
 * itself is not followed again.
 */
function settingsOf(checker, type, within = new Set()) {
  if (within.has(type.id)) return { options: optionsOf(checker, type), nested: {} };
  return remember(checker, "settings", type, () => findSettings(checker, type, within));
}

/**
 * The alternatives a type is: its union members and conditional branches;
 * an intersection whole, its properties' types intersected.
 */
function alternativeTypes(type) {
  if (type.flags & TypeFlags.Union) return type.getTypes().flatMap(alternativeTypes);
  if (type.flags & TypeFlags.Conditional)
    return [type.getTrueType(), type.getFalseType()].flatMap(alternativeTypes);
  return [type];
}

function findSettings(checker, type, within) {
  const options = optionsOf(checker, type);
  const nested = {};
  within.add(type.id);
  const properties = alternativeTypes(type).flatMap((part) => checker.getPropertiesOfType(part));
  for (const property of properties) {
    const value = checker.getNonNullableType(checker.getTypeOfSymbol(property));
    const parts = heldTypes(checker, value).filter(
      (part) => Object.keys(optionsOf(checker, part)).length > 0,
    );
    if (parts.length === 0) continue;
    const held = parts
      .map((part) => settingsOf(checker, part, within))
      .reduce((all, more) => joinedSettings(all, more));
    const keyed = keyedOf(checker, value) ? { keyed: true } : {};
    nested[property.name] = joinedSettings(
      Object.hasOwn(nested, property.name) ? nested[property.name] : undefined,
      { ...held, type: heldName(checker, value), ...keyed },
    );
  }
  within.delete(type.id);
  return { options, nested };
}

/** The settings of a type's options whose values hold settings, at any depth: `{ option: settings }`. */
const nestedOf = (checker, type) => settingsOf(checker, type).nested;

/** The settings of type `name`, declared in `file` of the TypeScript project `config` (for tests). */
export function settingsOfType(config, file, name) {
  const api = new API({ cwd: dirname(config) });
  try {
    const { checker } = api.updateSnapshot({ openProjects: [config] }).getProject(config);
    const where = { document: file, position: 0 };
    const symbol = checker.resolveName(name, SymbolFlags.Type, where, false);
    return settingsOf(checker, checker.getDeclaredTypeOfSymbol(symbol));
  } finally {
    api.close();
  }
}

/**
 * The arguments of the call whose "(" is at `open` in `source`, as text,
 * strings and comments skipped over.
 */
function callArguments(source, open) {
  const parts = [];
  let [depth, start] = [0, open + 1];
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") i = source.indexOf(c, i + 1);
    else if (source.startsWith("//", i)) i = source.indexOf("\n", i);
    else if (source.startsWith("/*", i)) i = source.indexOf("*/", i) + 1;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) {
      parts.push(source.slice(start, i));
      // A trailing comma leaves nothing after it.
      return parts.map((part) => part.trim()).filter(Boolean);
    } else if (c === "," && depth === 1) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  throw new Error("inventory: a call without its closing parenthesis");
}

/** Vue's modules whose components read bare attributes, and the functions that make them. */
const VUE_COMPONENTS = {
  "packages/vue/src/marks.ts": ["markComponent"],
  "packages/vue/src/layout.ts": ["layoutComponent", "placedComponent"],
};

/**
 * Vue's mark and layout components: each one's `flags` (the boolean
 * options a template may write as bare attributes, the last argument of
 * the call making it, as a list) and the options its props type lets be
 * `true`, which should be those flags.
 */
function vueFlags(root, { checker, program }) {
  const takesTrue = (type) =>
    shapesOf(type).some(
      (part) =>
        part.flags & TypeFlags.Boolean ||
        (part.flags & TypeFlags.BooleanLiteral && checker.typeToString(part) === "true"),
    );
  const components = {};
  for (const [path, makers] of Object.entries(VUE_COMPONENTS)) {
    const file = join(root, path);
    const source = readFileSync(file, "utf8");
    const flags = {};
    const making = new RegExp(`(?:${makers.join("|")})(?:<[^>]*>)?\\(\\s*"(\\w+)"`, "g");
    for (const match of source.matchAll(making)) {
      const last = callArguments(source, source.indexOf("(", match.index)).at(-1);
      flags[match[1]] = last.startsWith("[")
        ? [...last.matchAll(/"(\w+)"/g)].map(([, flag]) => flag).sort()
        : [];
    }
    const module = program.getSourceFile(file);
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(module))) {
      if (!(exported.name in flags)) continue;
      const [signature] = checker.getSignaturesOfType(
        checker.getTypeOfSymbol(exported),
        SignatureKind.Call,
      );
      const props = checker.getTypeOfSymbol(signature.getParameters()[0]);
      const booleans = new Set();
      for (const shape of shapesOf(props))
        for (const property of checker.getPropertiesOfType(shape))
          if (takesTrue(checker.getNonNullableType(checker.getTypeOfSymbol(property))))
            booleans.add(property.name);
      components[exported.name] = { flags: flags[exported.name], booleans: [...booleans].sort() };
    }
    for (const name of Object.keys(flags))
      if (!components[name])
        throw new Error(`inventory: Vue's ${name} is not exported by its name from ${path}`);
  }
  return components;
}

/** The props a Vue component's instances take (its `$props`), with their choices. */
function vueInstanceProps({ checker }, type) {
  const [construct] = checker.getSignaturesOfType(type, SignatureKind.Construct);
  const instance = checker.getReturnTypeOfSignature(construct);
  return optionsOf(checker, checker.getTypeOfSymbol(checker.getPropertyOfType(instance, "$props")));
}

/** The engine's mark types, mark functions, and options, and the adapters' chart props and events. */
function engineInventory(root) {
  const api = new API({ cwd: root });
  try {
    const configs = ["herceg", "react", "svelte", "vue"].map((name) =>
      join(root, "packages", name, "tsconfig.json"),
    );
    const snapshot = api.updateSnapshot({ openProjects: configs });
    const [engine, react, svelte, vue] = configs.map((config) => snapshot.getProject(config));
    const { checker, program } = engine;
    /** A name declared in `file` (a type, or a module's value), from `project`. */
    const declared = ({ checker }, file, name, meaning = SymbolFlags.Type) => {
      const document = join(root, "packages", file);
      const symbol = checker.resolveName(name, meaning, { document, position: 0 }, false);
      if (!symbol) throw new Error(`inventory: no ${name} in packages/${file}`);
      return meaning === SymbolFlags.Type
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbol(symbol);
    };
    const marks = {};
    const marksNested = {};
    for (const member of declared(engine, "herceg/src/spec/spec.ts", "MarkSpec").getTypes()) {
      const type = JSON.parse(
        checker.typeToString(checker.getTypeOfSymbol(checker.getPropertyOfType(member, "type"))),
      );
      const { type: _, ...options } = optionsOf(checker, member);
      marks[type] = joined(marks[type], options);
      marksNested[type] = joinedNested(marksNested[type], nestedOf(checker, member));
    }
    const index = program.getSourceFile(join(root, "packages/herceg/src/index.ts"));
    const factories = {};
    const factoriesNested = {};
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(index))) {
      const symbol =
        exported.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (!(symbol.flags & SymbolFlags.Function)) continue;
      const signatures = checker
        .getSignaturesOfType(checker.getTypeOfSymbol(symbol), SignatureKind.Call)
        .filter(
          (signature) =>
            checker.getReturnTypeOfSignature(signature)?.getSymbol()?.name === "ChartMark",
        );
      if (signatures.length === 0) continue;
      // A mark function's options are its last parameter (after the table, where it takes one).
      for (const signature of signatures) {
        const last = signature.getParameters().at(-1);
        if (!last) continue;
        const type = checker.getTypeOfSymbol(last);
        factories[exported.name] = joined(factories[exported.name], optionsOf(checker, type));
        factoriesNested[exported.name] = joinedNested(
          factoriesNested[exported.name],
          nestedOf(checker, type),
        );
      }
    }
    const typeOptions = (project, file, name) =>
      optionsOf(project.checker, declared(project, file, name));
    const valueOptions = (project, file, name) =>
      optionsOf(project.checker, declared(project, file, name, SymbolFlags.Value));
    // Vue's chart options are its props of optionProps, typed as its instances take them.
    const vueChart = pick(
      vueInstanceProps(vue, declared(vue, "vue/src/chart.ts", "Chart", SymbolFlags.Value)),
      [...Object.keys(valueOptions(vue, "vue/src/chart.ts", "optionProps")), "marks", "initial"],
    );
    const typeNested = (project, file, name) =>
      nestedOf(project.checker, declared(project, file, name));
    const chartSpec = declared(engine, "herceg/src/spec/spec.ts", "ChartSpec");
    const panelSpec = declared(engine, "herceg/src/spec/spec.ts", "PanelSpec");
    const events = (props, prefix) =>
      Object.keys(props).filter((name) => name.startsWith(prefix) && name.length > prefix.length);
    const reactChart = typeOptions(react, "react/src/chart.tsx", "ChartProps");
    const svelteChart = typeOptions(svelte, "svelte/src/chart.ts", "ChartProps");
    return {
      spec: Object.keys(marks).sort(),
      typescript: Object.keys(factories).sort(),
      options: {
        marks,
        factories,
        // The settings of each one's object options (as `nested` below, of the spec's options).
        marksNested,
        factoriesNested,
        chart: {
          spec: optionsOf(checker, chartSpec),
          nested: nestedOf(checker, chartSpec),
          typescript: typeOptions(engine, "herceg/src/dom/chart.ts", "ChartOptions"),
          typescriptNested: typeNested(engine, "herceg/src/dom/chart.ts", "ChartOptions"),
          react: reactChart,
          svelte: svelteChart,
          vue: vueChart,
        },
        panel: {
          spec: optionsOf(checker, panelSpec),
          nested: nestedOf(checker, panelSpec),
          typescript: typeOptions(engine, "herceg/src/layout/options.ts", "PanelDefinition"),
          typescriptNested: typeNested(engine, "herceg/src/layout/options.ts", "PanelDefinition"),
        },
        inset: {
          spec: typeOptions(engine, "herceg/src/spec/layout.ts", "InsetSpec"),
          nested: typeNested(engine, "herceg/src/spec/layout.ts", "InsetSpec"),
          typescript: typeOptions(engine, "herceg/src/layout/options.ts", "InsetOptions"),
          typescriptNested: typeNested(engine, "herceg/src/layout/options.ts", "InsetOptions"),
        },
        handle: Object.keys(typeOptions(engine, "herceg/src/dom/handle.ts", "Chart")),
        vueFlags: vueFlags(root, vue),
        events: {
          typescript: Object.keys(typeOptions(engine, "herceg/src/dom/events.ts", "ChartEvents")),
          react: events(reactChart, "on"),
          svelte: events(svelteChart, "on"),
          vue: Object.keys(valueOptions(vue, "vue/src/chart.ts", "emits")),
        },
      },
    };
  } finally {
    api.close();
  }
}

/** The components an adapter's index module exports. */
const componentsOf = (root, adapter) =>
  exportedComponents(readFileSync(join(root, "packages", adapter, "src/index.ts"), "utf8"));

/** Python's chart methods, helpers, and Express functions. */
function pythonInventory(root) {
  const output = execFileSync(
    "uv",
    ["run", "--extra", "dev", "python", "../scripts/contracts/inventory.py"],
    { cwd: join(root, "python"), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(output);
}

/** Every surface's names, as marks.json and express.json name them. */
export function discoverInventory(root) {
  const python = pythonInventory(root);
  const engine = engineInventory(root);
  return {
    spec: engine.spec,
    typescript: engine.typescript,
    python: python.chart.map((name) => `Chart.${name}`),
    helper: python.helpers,
    react: componentsOf(root, "react"),
    vue: componentsOf(root, "vue"),
    svelte: componentsOf(root, "svelte"),
    express: python.express,
    options: { ...engine.options, python: python.options },
  };
}

/**
 * Errors where something a surface offers is neither a row's nor listed
 * as something else, or a declaration names what does not exist.
 */
export function checkInventory({ marks, express }, inventory) {
  const errors = [];
  const compare = (where, found, declared, unlisted, file, section = "unlisted") => {
    const found_ = new Set(found);
    for (const name of found_)
      if (!declared.has(name) && !(name in unlisted))
        errors.push(
          `${where} ${name}: neither a row nor listed in ${file}'s ${section}; declare it`,
        );
    for (const name of [...declared, ...Object.keys(unlisted)])
      if (!found_.has(name))
        errors.push(`${where} ${name}: ${file} names it, but it does not exist; drop it`);
  };
  for (const surface of SURFACES) {
    const declared = new Set(
      Object.values(marks.rows)
        .map(({ inventory }) => inventory?.[surface])
        .filter((name) => typeof name === "string"),
    );
    compare(surface, inventory[surface], declared, marks.unlisted?.[surface] ?? {}, "marks.json");
  }
  compare(
    "express",
    inventory.express,
    new Set(Object.values(express.recipes).map(({ inventory }) => inventory)),
    express.utilities,
    "express.json",
    "utilities",
  );
  return errors;
}
