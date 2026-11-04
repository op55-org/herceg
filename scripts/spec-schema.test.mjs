// Tests of the spec schema's generation (scripts/generate-spec-schema.mjs)
// and of herceg's side of its agreement fixture
// (packages/herceg/test/fixtures/spec-schema.json); the schema's side is
// python/tests/test_spec_schema.py, which has the JSON Schema validator.

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "./contracts/source.mjs";
import { SCHEMA_PATH, schemaText, titleOf } from "./generate-spec-schema.mjs";
import { verdict } from "./spec-schema-cases.mjs";

const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const FIXTURE = read("packages/herceg/test/fixtures/spec-schema.json");
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

test("the published schema is the one the spec's types make, the same each time", () => {
  const text = schemaText();
  assert.equal(
    text,
    readFileSync(SCHEMA_PATH, "utf8"),
    "run node scripts/generate-spec-schema.mjs",
  );
  assert.equal(schemaText(), text);
});

test("a change of the spec's types changes the schema, with no edit of its own", () => {
  // A copy of the package's sources, with an option the spec does not have.
  const copy = mkdtempSync(join(tmpdir(), "herceg-schema-"));
  const pkg = join(copy, "packages/herceg");
  cpSync(join(root, "packages/herceg/src"), join(pkg, "src"), { recursive: true });
  cpSync(join(root, "packages/herceg/tsconfig.build.json"), join(pkg, "tsconfig.build.json"));
  cpSync(join(root, "tsconfig.base.json"), join(copy, "tsconfig.base.json"));
  const spec = join(pkg, "src/spec/spec.ts");
  const source = readFileSync(spec, "utf8");
  const declaration = "export interface ChartSpec extends StateSpec {\n";
  assert.ok(source.includes(declaration));
  writeFileSync(
    spec,
    source.replace(
      declaration,
      `${declaration}  /** Words the chart is found by. @minItems 1 */\n  tags?: readonly string[];\n`,
    ),
  );
  const text = schemaText(pkg);
  assert.notEqual(text, readFileSync(SCHEMA_PATH, "utf8"));
  assert.deepEqual(JSON.parse(text).$defs.ChartSpec.properties.tags, {
    title: "Tags",
    description: "Words the chart is found by.",
    type: "array",
    items: { type: "string" },
    minItems: 1,
  });
});

test("labels are derived from property names", () => {
  assert.equal(titleOf("strokeWidth"), "Stroke width");
  assert.equal(titleOf("yRight"), "Y right");
  assert.equal(titleOf("x"), "X");
});

/** The object forms of mark `type`'s schema, as `$ref`s and unions lead to them. */
function markForms(type) {
  const forms = [];
  const visit = (schema) => {
    if (schema.$ref) return visit(SCHEMA.$defs[decodeURIComponent(schema.$ref.slice(8))]);
    if (schema.properties) {
      if (schema.properties.type?.const === type) forms.push(schema);
    } else for (const member of schema.anyOf ?? []) visit(member);
  };
  visit({ $ref: "#/$defs/MarkSpec" });
  return forms;
}

test("the defaults every surface proves are the schema's", () => {
  const { defaults } = read("test/contracts/fixtures/defaults.json");
  for (const { contract, mark, option, at, value } of defaults) {
    // The forms of the mark that take the option (a 2D histogram has no element).
    const properties = (
      at === "chart"
        ? [SCHEMA.$defs.ChartSpec.properties[option]]
        : markForms(mark.type).map((form) => form.properties[option])
    ).filter(Boolean);
    assert.ok(properties.length > 0, contract);
    for (const property of properties) assert.deepEqual(property.default, value, contract);
  }
});

test("the schema and the export guide list what the schema cannot say, and where it is stricter", () => {
  const guide = readFileSync(join(root, "docs/guide/export.md"), "utf8");
  for (const { id, text } of [...FIXTURE.unsaid, ...FIXTURE.stricter]) {
    assert.ok(SCHEMA.description.includes(text), id);
    assert.ok(guide.includes(text), `docs/guide/export.md lists ${id}`);
  }
});

test("validateSpec refuses each invalid spec at its path", () => {
  for (const { name, spec, path } of FIXTURE.invalid) {
    const said = verdict(spec);
    assert.equal(said.stage, "validate", name);
    assert.ok(
      said.path === path || said.message.startsWith(`${path}:`),
      `${name}: ${said.message}`,
    );
  }
});

test("herceg refuses each witness of what the schema cannot say, by its rule", () => {
  for (const { id, matches, witnesses } of FIXTURE.unsaid)
    for (const witness of witnesses) {
      const said = verdict(witness);
      assert.equal(said.ok, false, id);
      assert.ok(
        matches.some((pattern) => new RegExp(pattern).test(said.message)),
        `${id}: ${said.message}`,
      );
    }
  for (const { id, witness, place, places } of FIXTURE.stricter) {
    assert.equal(verdict(witness).ok, true, id);
    assert.ok(
      places.some((pattern) => new RegExp(`^(?:${pattern})$`).test(place)),
      `${id}: ${place} is none of its places`,
    );
  }
});
