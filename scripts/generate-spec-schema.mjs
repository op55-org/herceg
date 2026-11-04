// Writes packages/herceg/spec.schema.json, a JSON Schema (draft 2020-12) of
// the portable spec, from its TypeScript types (packages/herceg/src/spec/),
// so that a spec change changes the schema with no edits of its own:
//
//   node scripts/generate-spec-schema.mjs           write it
//   node scripts/generate-spec-schema.mjs --check   fail if it is stale
//
// The types say the structure, and their doc comments the descriptions;
// tags in the doc comments say what the types cannot: `@default <json>`,
// `@examples <json list>`, `@minimum`, `@maximum`, `@exclusiveMinimum`, `@exclusiveMaximum`,
// `@integer`, `@minItems`, `@maxItems`, `@uniqueItems`, and `@items <json>`
// (keywords of a list's items, or a tuple's by position). Number tags on an option of a generic
// type's instance (`ChannelSpec<number>`) bound the numbers it holds, in a
// copy named with the bounds. Each object form is written whole and
// closed, as the validator refuses properties a form does not have. A type
// the generator has no JSON for (a function, `unknown`) fails it, naming
// where it is.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { SyntaxKind } from "typescript/unstable/ast";
import { API, SymbolFlags, TypeFlags } from "typescript/unstable/sync";
import { formatJson } from "./contracts/json.mjs";
import { root } from "./contracts/source.mjs";

export const SCHEMA_PATH = join(root, "packages/herceg/spec.schema.json");

/**
 * What herceg checks that the schema cannot say, listed in its description:
 * the rules of the fixture its agreement test reads.
 */
const FIXTURE = join(root, "packages/herceg/test/fixtures/spec-schema.json");

const NUMBER_TAGS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
const LIST_TAGS = ["minItems", "maxItems", "uniqueItems"];

/**
 * A doc comment as a description: its lines joined into paragraphs, but
 * for list items ("- ..."), which keep their own lines.
 */
function prose(comment) {
  return comment
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n(?!\s*- )\s*/g, " "))
    .join("\n\n");
}

/** "strokeWidth" as "Stroke width": a label derived from a property's name. */
export function titleOf(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The schema of the spec, as an object, from the types of the herceg
 * package in `directory` (packages/herceg by default).
 */
export function generateSchema(directory = join(root, "packages/herceg")) {
  const api = new API({ cwd: directory });
  try {
    const snapshot = api.updateSnapshot({ openProject: join(directory, "tsconfig.build.json") });
    const [project] = snapshot.getProjects();
    return new Generator(project.checker, join(directory, "src")).schema();
  } finally {
    api.close();
  }
}

class Generator {
  constructor(checker, sources) {
    this.checker = checker;
    this.sources = sources.toLowerCase();
    this.spec = join(sources, "spec/spec.ts");
    /** Each named type's schema, by name, as it is written. */
    this.defs = new Map();
    /** The named types by name, to tell two types of one name apart. */
    this.named = new Map();
  }

  schema() {
    const chart = this.resolve("ChartSpec");
    const ref = this.ref(chart, "ChartSpec");
    // What the spec reaches: a definition bounded copies replaced everywhere goes.
    const reached = new Set();
    const reach = (schema) => {
      if (schema === null || typeof schema !== "object") return;
      if (typeof schema.$ref === "string") {
        const name = decodeURIComponent(schema.$ref.slice("#/$defs/".length));
        if (!reached.has(name)) {
          reached.add(name);
          reach(this.defs.get(name));
        }
      }
      for (const value of Object.values(schema)) reach(value);
    };
    reach(ref);
    const defs = Object.fromEntries(
      [...this.defs].filter(([name]) => reached.has(name)).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
    const { unsaid, stricter } = JSON.parse(readFileSync(FIXTURE, "utf8"));
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Herceg chart spec",
      description: [
        "A chart as herceg's portable spec writes it (version 1): what Python's Chart.to_spec() writes, and loadSpec and validateSpec read. Generated from the spec's TypeScript types by scripts/generate-spec-schema.mjs.",
        "",
        "validateSpec and loadSpec also check what this schema cannot say:",
        ...unsaid.map(({ text }) => `- ${text}`),
        "",
        "This schema refuses what validateSpec takes in:",
        ...stricter.map(({ text }) => `- ${text}`),
      ].join("\n"),
      ...ref,
      $defs: defs,
    };
  }

  resolve(name) {
    const symbol = this.checker.resolveName(name, SymbolFlags.Type, {
      document: this.spec,
      position: 0,
    });
    if (!symbol) throw new Error(`generate-spec-schema: no type ${name} in ${this.spec}`);
    return this.checker.getDeclaredTypeOfSymbol(symbol);
  }

  /**
   * The name `type` is defined under, where it gets a definition of its
   * own: its alias's or interface's, with its type arguments where it is
   * an instance of a generic one (`ChannelSpec<number>`).
   */
  nameOf(type) {
    const alias = type.getAliasSymbol();
    if (alias) {
      if (!this.declared(alias)) return undefined;
      const args = type.getAliasTypeArguments();
      if (args.length === 0) return alias.name;
      return `${alias.name}<${args.map((arg) => this.checker.typeToString(arg)).join(", ")}>`;
    }
    if (!(type.flags & TypeFlags.Object)) return undefined;
    const symbol = type.getSymbol();
    if (!symbol || !(symbol.flags & (SymbolFlags.Interface | SymbolFlags.TypeAlias)))
      return undefined;
    if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) return undefined;
    if (type.isTypeReference?.() && this.checker.getTypeArguments(type).length > 0)
      throw new Error(`generate-spec-schema: generic interface ${symbol.name}; make it an alias`);
    return this.declared(symbol) ? symbol.name : undefined;
  }

  /** Whether `symbol` is one of herceg's own types. */
  declared(symbol) {
    return symbol.declarations[0]?.path.toLowerCase().startsWith(this.sources) === true;
  }

  ref(type, name) {
    const existing = this.named.get(name);
    if (existing !== undefined && existing !== type.id)
      throw new Error(`generate-spec-schema: two types named ${name}; rename one`);
    if (!this.defs.has(name)) {
      this.named.set(name, type.id);
      // Set first, so that a type reaching itself (Expression) refers to its definition.
      this.defs.set(name, {});
      const symbol = type.getAliasSymbol() ?? type.getSymbol();
      const description = prose(this.checker.getDocumentationCommentOfSymbol(symbol));
      const body = this.withTags(
        this.body(type, this.aliasNode(type), name),
        this.checker.getJsDocTagsOfSymbol(symbol),
        name,
      );
      this.defs.set(name, description ? { description, ...body } : body);
    }
    return { $ref: `#/$defs/${encodeURIComponent(name)}` };
  }

  /** The type node an alias is declared as, which keeps its union's members' names and order. */
  aliasNode(type) {
    const alias = type.getAliasSymbol();
    const declaration = alias?.declarations[0]?.resolve();
    return declaration?.kind === SyntaxKind.TypeAliasDeclaration ? declaration.type : undefined;
  }

  /** The schema of `type`: a reference to its definition when it is named, else written out. */
  of(type, node, where) {
    const name = this.nameOf(type);
    return name ? this.ref(type, name) : this.body(type, node, where);
  }

  body(type, node, where) {
    const { flags } = type;
    if (flags & (TypeFlags.Any | TypeFlags.Unknown | TypeFlags.Never | TypeFlags.TypeParameter))
      throw new Error(
        `generate-spec-schema: ${where} is ${this.checker.typeToString(type)}, which has no JSON`,
      );
    if (flags & TypeFlags.Union) return this.union(type, node, where);
    if (flags & TypeFlags.String) return { type: "string" };
    if (flags & TypeFlags.Number) return { type: "number" };
    if (flags & TypeFlags.Boolean) return { type: "boolean" };
    if (flags & TypeFlags.Null) return { type: "null" };
    if (flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral)) return { const: type.value };
    if (flags & TypeFlags.BooleanLiteral) return { const: type.value === true };
    if (this.openString(type)) return { type: "string" };
    if (flags & (TypeFlags.Object | TypeFlags.Intersection)) return this.object(type, where);
    throw new Error(
      `generate-spec-schema: ${where} is ${this.checker.typeToString(type)}, which has no JSON`,
    );
  }

  /**
   * A union's members, in the order and with the names of the type node
   * declaring it where that node says the same types, else as the checker
   * orders them.
   */
  members(type, node) {
    const flat = (types) =>
      types.flatMap((t) => (t.flags & TypeFlags.Union ? flat(t.getTypes()) : [t]));
    // An intersection of the union's own members (what `(A | B) & (A | B)`
    // spreads into) says nothing the members do not.
    const all = flat(type.getTypes());
    const ids = new Set(all.map((t) => t.id));
    const given = all.filter(
      (t) => !(t.flags & TypeFlags.Intersection) || !t.getTypes().every((part) => ids.has(part.id)),
    );
    let nodes = node;
    while (nodes?.kind === SyntaxKind.ParenthesizedType) nodes = nodes.type;
    if (nodes?.kind === SyntaxKind.UnionType) {
      const declared = nodes.types.map((member) => ({
        member,
        type: this.checker.getTypeFromTypeNode(member),
      }));
      const kept = new Set(given.map((t) => t.id));
      const listed = new Set(flat(declared.map(({ type }) => type)).map((t) => t.id));
      if (kept.size === listed.size && [...kept].every((id) => listed.has(id)))
        return declared.filter(({ type }) => !(type.flags & TypeFlags.Undefined));
    }
    return given.filter((t) => !(t.flags & TypeFlags.Undefined)).map((t) => ({ type: t }));
  }

  union(type, node, where) {
    // true | false is boolean, literals of one kind an enumeration, and
    // literals beside `string & {}` (any string) its suggestions.
    const slots = [];
    const literals = { string: [], number: [] };
    let booleans = 0;
    let open = false;
    for (const { type: member, member: memberNode } of this.members(type, node)) {
      const { flags } = member;
      if (flags & TypeFlags.BooleanLiteral) {
        if (!slots.includes("boolean")) slots.push("boolean");
        booleans |= member.value === true ? 1 : 2;
      } else if (
        flags & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral) &&
        !this.nameOf(member)
      ) {
        const kind = flags & TypeFlags.StringLiteral ? "string" : "number";
        if (!slots.includes(kind)) slots.push(kind);
        literals[kind].push(member.value);
      } else if (this.openString(member)) {
        if (!slots.includes("string")) slots.push("string");
        open = true;
      } else slots.push(this.of(member, memberNode, where));
    }
    const written = slots.map((slot) => {
      if (slot === "boolean")
        return booleans === 3 ? { type: "boolean" } : { const: booleans === 1 };
      if (slot === "string" && open)
        return { type: "string", ...(literals.string.length > 0 && { examples: literals.string }) };
      if (slot === "string" || slot === "number") {
        const values = literals[slot];
        return values.length === 1 ? { const: values[0] } : { type: slot, enum: values };
      }
      return slot;
    });
    return anyOf(factorForms(written));
  }

  /** Whether `type` is `string & {}`: any string, where literals beside it are suggestions. */
  openString(type) {
    if (!(type.flags & TypeFlags.Intersection)) return false;
    const parts = type.getTypes();
    return (
      parts.some((part) => part.flags & TypeFlags.String) &&
      parts.every(
        (part) =>
          part.flags & TypeFlags.String || this.checker.getPropertiesOfType(part).length === 0,
      )
    );
  }

  object(type, where) {
    const { checker } = this;
    if (checker.isArrayType(type)) {
      const [item] = checker.getTypeArguments(type);
      return { type: "array", items: this.of(item, undefined, `${where}[]`) };
    }
    if (checker.isTupleType(type)) return this.tuple(type, where);
    if (
      checker.getSignaturesOfType(type, 0).length > 0 ||
      checker.getSignaturesOfType(type, 1).length > 0
    )
      throw new Error(`generate-spec-schema: ${where} is a function, which has no JSON`);
    const schema = { type: "object" };
    const properties = {};
    const required = [];
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.name;
      const at = `${where}.${name}`;
      const value = checker.getTypeOfSymbol(property);
      if (value.flags & TypeFlags.Undefined) {
        // `x?: never`: a form that does not have the property.
        properties[name] = false;
        continue;
      }
      if (value.flags & TypeFlags.Never)
        throw new Error(`generate-spec-schema: ${at} is never; such a form cannot be written`);
      const optional = (property.flags & SymbolFlags.Optional) !== 0;
      if (!optional) required.push(name);
      const declaration = property.declarations[0]?.resolve();
      const node = declaration && "type" in declaration ? declaration.type : undefined;
      // The type as declared keeps its alias, which `T | undefined` loses,
      // where it is the same type (not a generic's parameter).
      const declared = node && checker.getTypeFromTypeNode(node);
      const same = declared && sameTypes(declared, value);
      properties[name] = this.property(property, this.of(same ? declared : value, node, at), at);
    }
    schema.properties = properties;
    if (required.length > 0) schema.required = required;
    const [index] = checker.getIndexInfosOfType(type);
    schema.additionalProperties = index
      ? this.of(index.valueType, undefined, `${where}[key]`)
      : false;
    return schema;
  }

  tuple(type, where) {
    const elements = this.checker.getTypeArguments(type);
    const flags = type.getTarget().elementFlags ?? type.elementFlags;
    const fixed = [];
    let rest;
    let minItems = 0;
    elements.forEach((element, i) => {
      const flag = flags[i];
      if (flag & 4) rest = this.of(element, undefined, `${where}[${i}]`);
      else {
        fixed.push(this.of(element, undefined, `${where}[${i}]`));
        if (flag & 1) minItems = i + 1;
      }
    });
    return {
      type: "array",
      prefixItems: fixed,
      items: rest ?? false,
      ...(minItems > 0 && { minItems }),
    };
  }

  /** A property's schema with its label, description, and tags. */
  property(symbol, schema, where) {
    const description = prose(this.checker.getDocumentationCommentOfSymbol(symbol));
    const written = { title: titleOf(symbol.name), ...(description && { description }), ...schema };
    return this.withTags(written, this.checker.getJsDocTagsOfSymbol(symbol), where);
  }

  /**
   * `schema` with what its declaration's tags say: its default, bounds of
   * the numbers and lists it holds directly or through its unions, and
   * keywords of its lists' items.
   */
  withTags(schema, tags, where) {
    const bounds = {};
    for (const { name, text } of tags) {
      const value = text === undefined ? undefined : parseTag(text.trim(), where, name);
      if (name === "default") schema.default = value;
      else if (name === "examples") examples(schema, where, value);
      else if (NUMBER_TAGS.includes(name)) bounds[name] = value;
      else if (name === "integer") bounds.type = "integer";
      else if (LIST_TAGS.includes(name)) arrays(schema, where, { [name]: value ?? true });
      else if (name === "items") items(schema, where, value);
      else throw new Error(`generate-spec-schema: ${where}: unknown tag @${name}`);
    }
    if (Object.keys(bounds).length > 0) this.constrain(schema, where, bounds);
    return schema;
  }

  /**
   * Bounds the numbers `schema` holds (see `numbers`), and those of the
   * generic types' instances it is or holds as a union's member (a
   * channel's constant and condition): their own, in copies of their
   * definitions named with the bounds (`ChannelSpec<number, minimum 0>`).
   * Where it holds neither, the numbers of its objects written out (an
   * intersection of instances), but through other types.
   */
  constrain(schema, where, bounds) {
    const own = members(schema);
    const instances = own.filter((s) => s.$ref && decodeURIComponent(s.$ref).includes("<"));
    let found = numbers(schema);
    if (found.length === 0 && instances.length === 0)
      found = own.filter((s) => s.type === "object").flatMap(numbersWithin);
    if (found.length === 0 && instances.length === 0)
      throw new Error(`generate-spec-schema: ${where}: a number tag on no number`);
    for (const number of found) Object.assign(number, bounds);
    for (const instance of instances) instance.$ref = this.bounded(instance.$ref, bounds, where);
  }

  /** A copy of the definition `$ref` names, its numbers bounded, by its name. */
  bounded($ref, bounds, where) {
    const name = decodeURIComponent($ref.slice("#/$defs/".length));
    const said = Object.entries(bounds).map(([k, v]) => (k === "type" ? v : `${k} ${v}`));
    const copy = `${name.slice(0, -1)}, ${said.join(", ")}>`;
    if (!this.defs.has(copy)) {
      const definition = structuredClone(this.defs.get(name));
      const held = numbersWithin(definition);
      if (held.length === 0)
        throw new Error(`generate-spec-schema: ${where}: a number tag on ${name}, of no number`);
      for (const number of held) Object.assign(number, bounds);
      this.defs.set(copy, definition);
    }
    return `#/$defs/${encodeURIComponent(copy)}`;
  }
}

/** A union's members, through nested unions, without `undefined`. */
function flatMembers(type) {
  if (!(type.flags & TypeFlags.Union)) return type.flags & TypeFlags.Undefined ? [] : [type];
  return type.getTypes().flatMap(flatMembers);
}

/** Whether `a` and `b` are the same types, but for `undefined`. */
function sameTypes(a, b) {
  const ids = new Set(flatMembers(a).map((t) => t.id));
  const others = new Set(flatMembers(b).map((t) => t.id));
  return ids.size === others.size && [...ids].every((id) => others.has(id));
}

/** One schema of `schemas`, `anyOf` them, with nested `anyOf`s flattened and repeats dropped. */
function anyOf(schemas) {
  const flat = schemas.flatMap((schema) =>
    schema.anyOf && Object.keys(schema).length === 1 ? schema.anyOf : [schema],
  );
  const unique = [...new Map(flat.map((schema) => [JSON.stringify(schema), schema])).values()];
  return unique.length === 1 ? unique[0] : { anyOf: unique };
}

const isForm = (schema) =>
  schema.type === "object" && schema.additionalProperties === false && schema.properties;

/**
 * A union's object forms (`{ x, y?: never } | { y, x?: never }`) as one
 * object: every form's properties once, each with its schema where the
 * forms agree, and `anyOf` the forms by what sets them apart (what each
 * requires, refuses, and takes otherwise), rather than each form whole. A
 * property whose forms differ is itself factored, each form then giving
 * what sets its own apart. Other members stay as they are, after it.
 */
function factorForms(schemas) {
  const forms = schemas.filter(isForm);
  if (forms.length < 2) return schemas;
  const names = [...new Set(forms.flatMap((form) => Object.keys(form.properties)))];
  const properties = {};
  /** For a property the forms differ in, what each form takes, by form. */
  const own = new Map();
  for (const name of names) {
    const variants = new Map();
    for (const form of forms) {
      const schema = form.properties[name];
      if (schema !== undefined && schema !== false) variants.set(JSON.stringify(schema), schema);
    }
    if (variants.size === 0) continue;
    const [first] = variants.values();
    if (variants.size === 1) {
      properties[name] = first;
      continue;
    }
    const bare = [...variants.values()].map(({ title, description, ...rest }) => rest);
    const label = {
      ...(first.title && { title: first.title }),
      ...(first.description && { description: first.description }),
    };
    const keys = [...variants.keys()];
    const which = (form) => keys.indexOf(JSON.stringify(form.properties[name]));
    const [merged] = bare.every(isForm) ? factorForms(bare) : [];
    properties[name] = { ...label, ...(merged ?? anyOf(bare)) };
    const taken = merged ? merged.anyOf : bare;
    own.set(
      name,
      forms.map((form) => (form.properties[name] ? taken[which(form)] : undefined)),
    );
  }
  const constraints = forms.map((form, i) => {
    const taken = {};
    for (const name of Object.keys(properties)) {
      const schema = form.properties[name];
      if (schema === undefined || schema === false) taken[name] = false;
      else if (own.has(name)) taken[name] = own.get(name)[i];
    }
    return {
      ...(form.required && { required: form.required }),
      ...(Object.keys(taken).length > 0 && { properties: taken }),
    };
  });
  const merged = { type: "object", properties, anyOf: constraints, additionalProperties: false };
  return [merged, ...schemas.filter((schema) => !isForm(schema))];
}

/** Gives `schema`, or the members of its union of the examples' JSON type, `values` as examples. */
function examples(schema, where, values) {
  const typed = (s) =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((v) => s.type === typeof v || (s.type === "integer" && Number.isInteger(v)));
  const found = members(schema).filter(typed);
  if (found.length === 0)
    throw new Error(
      `generate-spec-schema: ${where}: @examples takes a list of values of a type it has`,
    );
  for (const member of found) member.examples = values;
}

function parseTag(text, where, name) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`generate-spec-schema: ${where}: @${name} takes JSON; received ${text}`);
  }
}

/**
 * What `schema` is: itself, or its union's members, through nested unions.
 * A factored object's `anyOf` is its forms' constraints, not members.
 */
const members = (s) =>
  s === false ? [] : s.anyOf && !s.properties ? s.anyOf.flatMap(members) : [s];
const isNumber = (s) => s.type === "number" || s.type === "integer";

/**
 * The number schemas a tag bounds: those `schema` is, itself or as a union
 * member; or where it is none, its lists' items (a buffer's index beside a
 * list of values bounds the index). References are their declarations'.
 */
function numbers(schema) {
  const own = members(schema).filter((s) => !s.$ref);
  const direct = own.filter(isNumber);
  if (direct.length > 0) return direct;
  return own
    .filter((s) => s.type === "array")
    .flatMap((list) => [...(list.prefixItems ?? []), ...(list.items ? [list.items] : [])])
    .flatMap(members)
    .filter((s) => !s.$ref && isNumber(s));
}

/** The number schemas a definition holds anywhere in it, but through references. */
function numbersWithin(schema) {
  if (schema === false || schema === true || schema.$ref) return [];
  const inner = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.anyOf ?? []),
    ...(schema.prefixItems ?? []),
    ...(typeof schema.items === "object" ? [schema.items] : []),
    ...(typeof schema.additionalProperties === "object" ? [schema.additionalProperties] : []),
  ];
  return [...(isNumber(schema) ? [schema] : []), ...inner.flatMap(numbersWithin)];
}

/**
 * Gives the items of the lists `schema` is, itself or as a union member,
 * `keywords`: an object for every item, or a list of them for a tuple's
 * items by position.
 */
function items(schema, where, keywords) {
  const lists = members(schema).filter((s) => s.type === "array");
  const each = (list) => (typeof list.items === "object" ? [list.items] : (list.prefixItems ?? []));
  const fits = (list) =>
    Array.isArray(keywords)
      ? list.prefixItems?.length === keywords.length && list.items === false
      : each(list).length > 0;
  if (lists.length === 0 || typeof keywords !== "object" || !lists.every(fits))
    throw new Error(
      `generate-spec-schema: ${where}: @items takes an object of keywords, on a list, or a list of them, one per item of a tuple`,
    );
  for (const list of lists)
    for (const [i, item] of each(list).entries())
      Object.assign(item, Array.isArray(keywords) ? keywords[i] : keywords);
}

function arrays(schema, where, keywords) {
  const found =
    schema.type === "array" ? [schema] : (schema.anyOf ?? []).filter((s) => s.type === "array");
  if (found.length === 0) throw new Error(`generate-spec-schema: ${where}: a list tag on no list`);
  for (const array of found) Object.assign(array, keywords);
}

/** The schema as the file holds it. */
export function schemaText(directory) {
  return formatJson(generateSchema(directory));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { check: { type: "boolean" } } });
  const text = schemaText();
  const path = relative(root, SCHEMA_PATH);
  if (values.check) {
    let current;
    try {
      current = readFileSync(SCHEMA_PATH, "utf8");
    } catch {}
    if (current !== text) {
      console.error(
        `generate-spec-schema: ${path} is stale; run node scripts/generate-spec-schema.mjs`,
      );
      process.exit(1);
    }
    console.log(`generate-spec-schema: ${path} is current`);
  } else {
    writeFileSync(SCHEMA_PATH, text);
    console.log(`generate-spec-schema: wrote ${path}`);
  }
}
