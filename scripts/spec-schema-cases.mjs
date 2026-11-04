// The specs that python/tests/test_spec_schema.py checks the spec schema
// (packages/herceg/spec.schema.json) against, with what herceg says of
// each: every spec of the fixtures shared by the engine and Python, the
// JSON examples in the docs, the schema fixture's own cases, probes of
// every option, and, for every spec validateSpec takes, changes of it:
// each property dropped, one added to
// each object, and each value replaced by values of other types, by
// numbers at and past common bounds, and by an unknown name. A change is
// made once per mark type, option (and position in its lists), and kind of
// change.
//
//   node scripts/spec-schema-cases.mjs    prints { cases: [...] } as JSON
//
// Each case's `engine` is what herceg says: `{ ok: true }`, or the stage
// that refused it (validate: validateSpec; load: loadSpec; draw: drawing
// it to SVG) with the error's code, path, and message. A probe also gives
// the `alternative` it sets: the form of each union on its path (`|i`) and
// the value of an enumeration it takes (`=i`).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { root } from "./contracts/source.mjs";

const { validateSpec } = await import(join(root, "packages/herceg/src/spec/validate.ts"));
const { loadSpec } = await import(join(root, "packages/herceg/src/spec/load.ts"));
const { specToSVG } = await import(join(root, "packages/herceg/src/from-spec.ts"));

const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const FIXTURES = "packages/herceg/test/fixtures";

/** What herceg says of `spec`: whether it validates, loads, and draws, or where it is refused. */
export function verdict(spec) {
  for (const [stage, run] of [
    ["validate", () => validateSpec(spec)],
    ["load", () => loadSpec(spec)],
    ["draw", () => specToSVG(spec)],
  ]) {
    try {
      run();
    } catch (error) {
      const { code, path, message } = error;
      return { ok: false, stage, code: code ?? null, path: path ?? null, message: String(message) };
    }
  }
  return { ok: true };
}

/** Each table of `tables` as the spec writes it: its columns, by name. */
const tablesOf = (tables) =>
  Object.fromEntries(Object.entries(tables).map(([name, columns]) => [name, { columns }]));

/** The JSON blocks of the docs and READMEs that are charts, or chart options alone (given no marks). */
function docsSpecs() {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".md")) files.push(path);
    }
  };
  visit("docs");
  files.push("README.md", "packages/herceg/README.md", "python/README.md");
  const specs = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const [i, [, block]] of [...text.matchAll(/```json\n([\s\S]*?)```/g)].entries()) {
      const value = JSON.parse(block);
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      specs.push({
        name: `${relative(root, join(root, file))} json ${i}`,
        spec: { marks: [], ...value },
      });
    }
  }
  return specs;
}

/** The fixtures' charts, each a whole spec. */
export function fixtureSpecs() {
  const specs = [];
  const add = (name, spec) => specs.push({ name, spec });

  const contracts = read(`${FIXTURES}/contracts.json`);
  const data = { data: { columns: contracts.data } };
  for (const { name, spec } of contracts.cases) add(`contracts: ${name}`, { data, ...spec });

  const errors = read(`${FIXTURES}/chart-errors.json`);
  for (const { name, mark } of errors.cases)
    add(`chart-errors: ${name}`, { data: { data: { columns: errors.data } }, marks: [mark] });

  const viewport = read(`${FIXTURES}/viewport-events.json`);
  for (const { name, spec } of viewport.cases)
    add(`viewport-events: ${name}`, { data: { data: { columns: viewport.data } }, ...spec });
  for (const file of ["provenance-events.json", "color-identity.json"])
    for (const { name, spec } of read(`${FIXTURES}/${file}`).cases)
      if (spec) add(`${file.replace(".json", "")}: ${name}`, spec);

  const rows = read("test/contracts/fixtures/rows.json");
  for (const [row, { table, mark }] of Object.entries(rows.rows)) {
    if (!mark) continue;
    // A network's links name their nodes' table.
    const names = [table, ...(mark.nodes ? [mark.nodes] : [])];
    const tables = tablesOf(Object.fromEntries(names.map((name) => [name, rows.tables[name]])));
    add(`rows: ${row}`, { data: tables, marks: [{ ...mark, data: table }] });
  }

  const { tables, defaults } = read("test/contracts/fixtures/defaults.json");
  for (const { contract, table, mark, option, at, value, other } of defaults) {
    const base = { data: tablesOf({ [table]: tables[table] }), marks: [mark] };
    const set = (v) =>
      at === "chart" ? { ...base, [option]: v } : { ...base, marks: [{ ...mark, [option]: v }] };
    add(`defaults: ${contract}`, base);
    add(`defaults: ${contract} = ${JSON.stringify(value)}`, set(value));
    add(`defaults: ${contract} = ${JSON.stringify(other)}`, set(other));
  }

  for (const { name, spec } of docsSpecs()) add(`docs: ${name}`, spec);
  return specs;
}

// Past the common bounds (opacities, percents, angles, longitudes), and not so far that a count of them (a boxen's depth) takes the engine minutes.
const NUMBERS = [-1e4, -1, 0, 0.5, 1, 1.5, 1e4];

/** The changes of a value: other values, each with the kind of change it is. */
function replacements(value) {
  if (typeof value === "number") return [...NUMBERS.map((n) => [`number ${n}`, n]), ["text", "x"]];
  if (typeof value === "string")
    return [
      ["unknown name", "zz"],
      ["number", 1],
    ];
  if (typeof value === "boolean") return [["text", "true"]];
  if (value === null) return [["number", 1]];
  if (Array.isArray(value))
    return [
      ["empty list", []],
      ["object", {}],
    ];
  return [["number", 1]];
}

/** A value's place, as the same place in other specs: indices left out, and a mark's type named. */
const placeOf = (path, spec) => {
  const mark = /^marks\[(\d+)\]/.exec(path);
  const type = mark ? spec.marks[Number(mark[1])]?.type : "chart";
  return `${type}: ${path.replace(/\[\d+\]/g, "[]")}`;
};

/** `spec` with `change` made to the value at `keys`. */
function changed(spec, keys, change) {
  const copy = structuredClone(spec);
  let parent = copy;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  change(parent, keys.at(-1));
  return copy;
}

/** The changes of `spec`, each made once per place, position, and kind of change across `seen`. */
function changesOf(name, spec, seen) {
  const cases = [];
  const add = (path, kind, keys, change) => {
    // At each position in its lists, as a tuple's members differ; a mark's aside.
    const key = `${placeOf(path, spec)} ${path.replace(/^marks\[\d+\]/, "")} ${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({
      name: `${name}: ${path || "spec"} ${kind}`,
      place: placeOf(path, spec),
      spec: changed(spec, keys, change),
    });
  };
  const visit = (value, keys, path) => {
    // A column of cells is data, not options; a column's spec has options.
    if (keys.length === 4 && keys[0] === "data" && keys[2] === "columns" && Array.isArray(value))
      return;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      add(path, "property added", [...keys, "zzUnknown"], (parent, key) => {
        parent[key] = 1;
      });
      for (const [key, item] of Object.entries(value)) {
        const at = path ? `${path}.${key}` : key;
        add(at, "dropped", [...keys, key], (parent, k) => {
          delete parent[k];
        });
        visit(item, [...keys, key], at);
      }
    } else if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) visit(item, [...keys, i], `${path}[${i}]`);
    }
    if (keys.length > 0)
      for (const [kind, replacement] of replacements(value))
        add(path, kind, keys, (parent, key) => {
          parent[key] = structuredClone(replacement);
        });
  };
  visit(spec, [], "");
  return cases;
}

/**
 * Values the schema takes, for options no fixture sets: what `schema`
 * requires and nothing more, its first form where it has several, numbers
 * within its bounds, and for strings `text` (a field of the table, where
 * the option names one).
 */
function sampler(root, text) {
  const resolve = (schema) => {
    let resolved = schema;
    while (resolved?.$ref) {
      const { $ref, ...rest } = resolved;
      resolved = { ...root.$defs[decodeURIComponent($ref.slice("#/$defs/".length))], ...rest };
    }
    return resolved;
  };
  // `step`: a number's place in the lists it is in, which it is raised by,
  // so that ranges (domains, a projection's corners) ascend.
  const sample = (given, depth = 0, step = 0) => {
    const schema = resolve(given);
    if (depth > 8) throw new Error("spec-schema-cases: no finite sample");
    if (schema.const !== undefined) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.examples) return schema.examples[0];
    if (schema.properties && schema.type === "object") return object(schema, depth);
    if (schema.anyOf) {
      const simple = schema.anyOf.map(resolve).find((s) => s.type !== "null" && !s.anyOf);
      return sample(simple ?? schema.anyOf[0], depth + 1);
    }
    if (schema.type === "string") return text;
    if (schema.type === "number" || schema.type === "integer") {
      const low =
        schema.minimum ??
        (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 0.5 : undefined) ??
        Math.min(1, schema.maximum ?? 1, (schema.exclusiveMaximum ?? 2) - 0.5);
      const raised = low + step;
      return raised > (schema.maximum ?? Infinity) ||
        raised >= (schema.exclusiveMaximum ?? Infinity)
        ? low
        : raised;
    }
    if (schema.type === "boolean") return true;
    if (schema.type === "null") return null;
    if (schema.type === "array") {
      const items = (schema.prefixItems ?? []).map((item, i) =>
        sample(item, depth + 1, step * 2 + i),
      );
      while (items.length < (schema.minItems ?? (schema.prefixItems ? 0 : 1)))
        items.push(sample(schema.items, depth + 1, step * 2 + items.length));
      return items;
    }
    if (schema.type === "object") return {};
    throw new Error(`spec-schema-cases: no sample of ${JSON.stringify(schema).slice(0, 80)}`);
  };
  /** An object of what the form requires: its first form's, for factored forms. */
  const object = (schema, depth) => {
    const [form] = schema.anyOf ? formsOf(schema) : [schema];
    return Object.fromEntries(
      (form.required ?? []).map((name) => [name, sample(form.properties[name], depth + 1)]),
    );
  };
  /**
   * A factored object's forms, whole: the options they share, with what
   * each form takes of them. A form's own constraint on an option that is
   * itself factored is what it takes of that option's options, so it is
   * completed with them, to any depth.
   */
  const complete = (shared, own) => {
    if (own === undefined) return shared;
    const constraint =
      own !== false && !["type", "$ref", "anyOf", "const", "enum"].some((k) => k in own);
    if (!constraint) return own;
    const base = resolve(shared);
    const names = new Set([
      ...Object.keys(base.properties ?? {}),
      ...Object.keys(own.properties ?? {}),
    ]);
    return {
      type: "object",
      properties: Object.fromEntries(
        [...names].map((name) => [name, complete(base.properties?.[name], own.properties?.[name])]),
      ),
      required: [...(base.required ?? []), ...(own.required ?? [])],
      additionalProperties: false,
    };
  };
  const formsOf = (schema) =>
    schema.anyOf.map((form) => complete({ ...schema, anyOf: undefined }, form));
  return { resolve, sample, formsOf };
}

/** How deep option paths go: the chart's or a mark's option, and four more. */
const DEPTH = 5;

/**
 * `schema` with examples of Intl's codes, which it takes as any string
 * (Intl's TypeScript types), for the sampler to set: a currency and a unit
 * Intl knows, where a column's name would not be one.
 */
function withIntlCodes(schema) {
  const codes = { currency: "EUR", unit: "kilometer" };
  const copy = structuredClone(schema);
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    for (const [name, code] of Object.entries(codes))
      if (node.properties?.[name]?.type === "string") node.properties[name].examples = [code];
    for (const value of Object.values(node)) visit(value);
  };
  visit(copy);
  return copy;
}

/** What the sampler writes for text: a field's name, filled in per probe with each column's. */
const TEXT = "\u0001text";

/**
 * An option's alternatives: each member of its union, through nested
 * unions and references, a factored union's forms completed with their
 * shared options.
 */
function alternatives(given, tools) {
  const schema = tools.resolve(given);
  if (schema.type === "object" && schema.properties)
    return schema.anyOf ? tools.formsOf(schema) : [schema];
  if (schema.anyOf) return schema.anyOf.flatMap((member) => alternatives(member, tools));
  return [schema];
}

/** `path` and `inner` joined as the place of an option inside another. */
const joined = (path, inner) =>
  inner === "" || inner.startsWith("[") ? `${path}${inner}` : `${path}.${inner}`;

/**
 * Values of an option that set each option inside it, to any depth below
 * `DEPTH`, in each of its alternatives: an object form with what it
 * requires, then that with each of its options set the same way; a list
 * with an item set each way, a tuple with each member, a dictionary with
 * an entry; else each value it lists (an enumeration's, or its examples),
 * or a value of it. Each value with the place of what it sets
 * (`path`), and a key telling apart places in different alternatives. A
 * named type's options are the same wherever it is, so they are set at the
 * first place `expanded` (of names) sees it, and elsewhere it is set plainly.
 */
function settings(given, tools, expanded, depth = 1, inside = []) {
  // A type inside itself (an expression's operands) is set once.
  if (given.$ref && inside.includes(given.$ref)) return [];
  const within = given.$ref ? [...inside, given.$ref] : inside;
  const again = given.$ref !== undefined && expanded.has(given.$ref);
  if (given.$ref) expanded.add(given.$ref);
  const found = [];
  const members = alternatives(given, tools);
  for (const [i, member] of members.entries()) {
    const form = members.length > 1 ? `|${i}` : "";
    const add = (key, path, value) => found.push({ key: `${form}${key}`, path, value });
    const deeper = (schema) =>
      depth < DEPTH && !again ? settings(schema, tools, expanded, depth + 1, within) : [];
    if (member.type === "object" && member.properties) {
      const base = Object.fromEntries(
        (member.required ?? []).map((name) => [name, tools.sample(member.properties[name])]),
      );
      add("", "", base);
      for (const [name, property] of Object.entries(member.properties))
        if (property !== false)
          for (const inner of deeper(property))
            add(`.${name}${inner.key}`, joined(name, inner.path), { ...base, [name]: inner.value });
      if (typeof member.additionalProperties === "object")
        for (const inner of deeper(member.additionalProperties))
          add(`{}${inner.key}`, joined("{}", inner.path), { ...base, probe: inner.value });
    } else if (member.type === "array") {
      const base = tools.sample(member);
      add("", "", base);
      // A member's plain value is the base's, raised so that its members ascend.
      for (const [at, item] of (member.prefixItems ?? []).entries())
        for (const inner of deeper(item))
          if (inner.key !== "")
            add(`[${at}]${inner.key}`, joined("[]", inner.path), base.with(at, inner.value));
      if (typeof member.items === "object")
        for (const inner of deeper(member.items))
          add(`[]${inner.key}`, joined("[]", inner.path), [
            inner.value,
            ...base.slice(1, Math.max(member.minItems ?? 1, 1)),
          ]);
    } else if (member.type === "object" && typeof member.additionalProperties === "object") {
      add("", "", {});
      for (const inner of deeper(member.additionalProperties))
        add(`{}${inner.key}`, joined("{}", inner.path), { probe: inner.value });
    }
    // Each value an enumeration lists or its examples give, the first plainly.
    else
      for (const [i, value] of (member.enum ?? member.examples ?? [tools.sample(member)]).entries())
        add(i === 0 ? "" : `=${i}`, "", value);
  }
  return found;
}

/** `value` with the sampler's text written as `text`. */
function filled(value, text) {
  if (value === TEXT) return text;
  if (Array.isArray(value)) return value.map((item) => filled(item, text));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, filled(v, text)]));
  return value;
}

/**
 * The first of `specs` herceg draws, as the probe's, else the first
 * validateSpec takes (whose changes are still made), else the first.
 */
function drawn(specs) {
  let first;
  let validated;
  for (const spec of specs) {
    first ??= spec;
    const engine = verdict(spec);
    if (engine.ok) return spec;
    if (engine.stage !== "validate") validated ??= spec;
  }
  return validated ?? first;
}

/**
 * `mark` in the form `form` of its type: its options the form has, and
 * the sampler's values of those it requires but `mark` does not set (an
 * error bar's x2 beside its x1).
 */
function inForm(mark, form, tools) {
  const kept = Object.entries(mark).filter(
    ([name]) => name === "data" || (name in form.properties && form.properties[name] !== false),
  );
  const missing = (form.required ?? [])
    .filter((name) => !(name in mark))
    .map((name) => [name, tools.sample(form.properties[name])]);
  return Object.fromEntries([...kept, ...missing]);
}

/** A matrix row's chart: its tables, its mark over its table, and the names of their columns. */
function rowChart(rows, row) {
  const { table, mark } = rows.rows[row];
  const names = [table, ...(mark.nodes ? [mark.nodes] : [])];
  const data = tablesOf(Object.fromEntries(names.map((name) => [name, rows.tables[name]])));
  const columns = [...new Set(names.flatMap((name) => Object.keys(rows.tables[name])))];
  return { data, mark: { ...mark, data: table }, columns };
}

/**
 * Each matrix row's chart (rows.json) with each option of its mark set,
 * and a chart with each chart option set, at any depth below `DEPTH` and
 * in each alternative, to values the schema takes: options no fixture
 * sets, to be changed as the fixtures' are. Text is each column's name in
 * turn, and a chart option is set on each row's chart in turn (then with
 * its mark in a panel, for panels and layouts), and a mark's option on the
 * row's mark, then on it in the option's form, until herceg draws one, or
 * else validateSpec takes one: what is changed is then a spec herceg
 * takes. A place is probed once per mark type and alternative, and an
 * option the row's mark sets only where it holds options.
 */
function probes(schema) {
  const rows = read("test/contracts/fixtures/rows.json");
  const tools = sampler(withIntlCodes(schema), TEXT);
  const charts = Object.keys(rows.rows)
    .filter((row) => rows.rows[row].mark)
    .map((row) => rowChart(rows, row));
  const specs = [];
  const probed = new Set();
  // The named types set, per mark type and for the chart's options.
  const expanded = new Map();
  const expandedFor = (owner) => expanded.get(owner) ?? expanded.set(owner, new Set()).get(owner);
  for (const { data, mark, columns } of charts) {
    const own = alternatives({ $ref: "#/$defs/MarkSpec" }, tools).filter(
      (form) => form.properties.type?.const === mark.type,
    );
    for (const form of own)
      for (const [name, property] of Object.entries(form.properties)) {
        if (property === false || name === "type" || name === "data") continue;
        for (const { key, path, value } of settings(property, tools, expandedFor(mark.type))) {
          const at = joined(name, path);
          const seen = `${mark.type}: ${name}${key}`;
          // A row's own value is the fixture's.
          if (probed.has(seen) || (path === "" && isDeepStrictEqual(mark[name], value))) continue;
          probed.add(seen);
          // On the row's mark, else on it in this form, else (a panel) in a panel of its own.
          const marks = [
            { ...mark, [name]: value },
            { ...inForm(mark, form, tools), [name]: value },
          ];
          const candidates = marks.flatMap((set) =>
            columns.map((text) => ({ data, marks: [filled(set, text)] })),
          );
          if (name === "panel")
            for (const text of columns)
              candidates.push({ data, panels: [{ id: text }], marks: [filled(marks[0], text)] });
          specs.push({
            name: `probe ${mark.type}.${at}`,
            place: `${mark.type}: marks[].${at}`,
            alternative: key,
            spec: drawn(candidates),
          });
        }
      }
  }
  const chart = tools.resolve({ $ref: "#/$defs/ChartSpec" });
  // The rows' charts with their mark in a panel, named as text is (panels' and layouts' options).
  const paneled = charts.map((at) => ({ ...at, mark: { ...at.mark, panel: TEXT } }));
  /** A chart option set to `value` on a row's chart, its text a column's, `beside` another option. */
  const specOf = (name, value, { at, text, beside }) => ({
    data: at.data,
    marks: [filled(at.mark, text)],
    ...filled(beside, text),
    [name]: filled(value, text),
  });
  /** The first row's chart and column herceg draws `value` with, `beside` the options given. */
  const drawnOn = (name, value, beside = {}, among = [...charts, ...paneled]) =>
    among
      .flatMap((at) => at.columns.map((text) => ({ at, text, beside })))
      .find((place) => verdict(specOf(name, value, place)).ok);
  const options = Object.entries(chart.properties)
    .filter(([name]) => !["data", "marks", "version"].includes(name))
    .map(([name, property]) => [name, settings(property, tools, expandedFor("chart"))]);
  // Where each alternative of an option is drawn: its plain value, on the
  // first row's chart herceg draws it on, else beside another option's
  // plain value where it needs one (a layout's insets beside panels).
  const alternativeOf = (name, key) => `${name}${/^(\|\d+)?/.exec(key)[0]}`;
  const baselines = new Map();
  for (const [name, list] of options)
    for (const { key, path, value } of list)
      if (path === "" && !baselines.has(alternativeOf(name, key)))
        baselines.set(alternativeOf(name, key), { name, value, place: drawnOn(name, value) });
  const plain = [...baselines.values()].filter(
    ({ place }) => place && !Object.keys(place.beside).length,
  );
  for (const baseline of baselines.values())
    if (!baseline.place)
      for (const other of plain) {
        if (other.name === baseline.name) continue;
        baseline.place = drawnOn(baseline.name, baseline.value, { [other.name]: other.value }, [
          charts[0],
          paneled[0],
        ]);
        if (baseline.place) break;
      }
  for (const [name, list] of options)
    for (const { key, path, value } of list) {
      if (probed.has(`chart: ${name}${key}`)) continue;
      probed.add(`chart: ${name}${key}`);
      const { place } = baselines.get(alternativeOf(name, key));
      // An option inside drawn elsewhere than its option's place (breaks, on a time axis).
      const fits = place && verdict(specOf(name, value, place)).ok;
      const at = fits ? place : (drawnOn(name, value, place?.beside) ?? place);
      specs.push({
        name: `probe chart.${joined(name, path)}`,
        place: `chart: ${joined(name, path)}`,
        alternative: key,
        spec: at
          ? specOf(name, value, at)
          : specOf(name, value, { at: charts[0], text: charts[0].columns[0], beside: {} }),
      });
    }
  // Each kind of column, in a table of one row beside a line's columns.
  for (const { key, path, value } of settings(
    { $ref: "#/$defs/ColumnSpec" },
    tools,
    expandedFor("data"),
  )) {
    if (probed.has(`data: ${key}`)) continue;
    probed.add(`data: ${key}`);
    const at = joined("data.{}.columns.{}", path);
    specs.push({
      name: `probe ${at}`,
      place: `chart: ${at}`,
      alternative: key,
      spec: drawn(
        ["x", "y"].map((text) => ({
          data: { t: { columns: { x: [1], y: [1], probe: filled(value, text) } } },
          marks: [{ type: "line", data: "t", x: "x", y: "y" }],
        })),
      ),
    });
  }
  return specs;
}

/** Every case: the fixtures' specs, the schema fixture's, and the changes of those herceg draws. */
export function cases() {
  const fixture = read(`${FIXTURES}/spec-schema.json`);
  const schema = read("packages/herceg/spec.schema.json");
  const specs = [
    ...fixtureSpecs(),
    ...probes(schema),
    ...fixture.invalid.map(({ name, spec }) => ({ name: `invalid: ${name}`, spec })),
    ...fixture.unsaid.flatMap(({ id, witnesses }) =>
      witnesses.map((spec, i) => ({ name: `unsaid: ${id} ${i + 1}`, spec })),
    ),
    ...fixture.stricter.map(({ id, witness, place }) => ({
      name: `stricter: ${id}`,
      spec: witness,
      place,
    })),
  ];
  const all = specs.map((spec) => ({ ...spec, engine: verdict(spec.spec) }));
  // Changes of every spec validateSpec takes: one that loading or drawing
  // refuses still shows what validateSpec says of each change, and its
  // changes refused for the same reason match that reason's rule.
  const seen = new Set();
  for (const { name, spec, engine } of all.slice(0, specs.length))
    if (engine.ok || engine.stage !== "validate")
      for (const change of changesOf(name, spec, seen))
        all.push({ ...change, changed: true, engine: verdict(change.spec) });
  return all;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify({ cases: cases() }));
}
