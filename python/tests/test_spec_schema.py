"""The spec's JSON Schema (packages/herceg/spec.schema.json, ``hg.spec_schema()``)
against herceg's own checks, through ``jsonschema``: the schema takes what
herceg takes, and refuses what herceg refuses but for what it cannot say
(packages/herceg/test/fixtures/spec-schema.json: each such rule's text,
witnesses, and the messages of its refusals). The specs are every fixture's,
the docs' JSON examples, every option of every mark set once, and changes of
each (scripts/spec-schema-cases.mjs, which gives what herceg says of each);
and the specs Python writes from the shared fixtures."""

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from test_api_defaults import DEFAULTS
from test_api_defaults import made as default_chart
from test_contracts import CONTRACTS
from test_contracts import made as contract_spec

import herceg as hg

ROOT = Path(__file__).parents[2]
SCHEMA = json.loads((ROOT / "packages" / "herceg" / "spec.schema.json").read_text())
FIXTURE = json.loads(
    (ROOT / "packages" / "herceg" / "test" / "fixtures" / "spec-schema.json").read_text()
)
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)


@pytest.fixture(scope="module")
def cases() -> list[dict[str, Any]]:
    node = shutil.which("node")
    if node is None:
        pytest.fail("the schema's cases come from scripts/spec-schema-cases.mjs, run by node")
    script = ROOT / "scripts" / "spec-schema-cases.mjs"
    # It imports the engine's TypeScript sources, which Node reads with types stripped.
    run = subprocess.run(
        [node, "--experimental-strip-types", str(script)],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(run.stdout)["cases"]


def refusal(spec: Any) -> str | None:
    """Why the schema refuses ``spec``, or None where it takes it."""
    error = jsonschema.exceptions.best_match(VALIDATOR.iter_errors(spec))
    return None if error is None else f"{error.json_path}: {error.message[:200]}"


def unsaid(message: str) -> tuple[str, str] | None:
    """The rule the schema cannot say that ``message`` refuses by, and the
    pattern of the rule's messages it matches, if any."""
    for rule in FIXTURE["unsaid"]:
        for pattern in rule["matches"]:
            if re.search(pattern, message):
                return rule["id"], pattern
    return None


def test_hg_spec_schema_reads_the_schema_the_npm_package_publishes():
    assert hg.spec_schema() == SCHEMA


def test_the_schema_is_a_draft_2020_12_schema():
    jsonschema.Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"


def test_the_schema_says_what_it_cannot_say_and_where_it_is_stricter():
    for rule in FIXTURE["unsaid"] + FIXTURE["stricter"]:
        assert rule["text"] in SCHEMA["description"], rule["id"]


@pytest.mark.parametrize("case", FIXTURE["invalid"], ids=lambda case: case["name"])
def test_the_invalid_specs_are_refused(case):
    assert refusal(case["spec"]) is not None


def test_each_rule_the_schema_cannot_say_has_witnesses(cases):
    witnesses = {case["name"]: case for case in cases if case["name"].startswith("unsaid: ")}
    for rule in FIXTURE["unsaid"]:
        assert rule["witnesses"], rule["id"]
        for i in range(len(rule["witnesses"])):
            case = witnesses[f"unsaid: {rule['id']} {i + 1}"]
            assert refusal(case["spec"]) is None, case["name"]
            assert not case["engine"]["ok"], case["name"]
            matched = unsaid(case["engine"]["message"])
            assert matched is not None and matched[0] == rule["id"], case["engine"]["message"]


def test_each_spec_the_schema_refuses_herceg_takes_has_a_witness(cases):
    witnesses = {case["name"]: case for case in cases if case["name"].startswith("stricter: ")}
    for rule in FIXTURE["stricter"]:
        case = witnesses[f"stricter: {rule['id']}"]
        assert refusal(case["spec"]) is not None, rule["id"]
        assert case["engine"]["ok"], rule["id"]


def stricter(place: str | None) -> tuple[str, str] | None:
    """The place pattern of where the schema may be stricter that ``place`` is in, if any."""
    for rule in FIXTURE["stricter"]:
        for pattern in rule["places"]:
            if place is not None and re.fullmatch(pattern, place):
                return rule["id"], pattern
    return None


def test_the_schema_and_herceg_agree_on_every_spec_and_change(cases):
    disagreements = []
    matched = set()
    for case in cases:
        refused, engine = refusal(case["spec"]), case["engine"]
        if refused is None and not engine["ok"]:
            rule = unsaid(engine["message"])
            if rule is None:
                disagreements.append(f"{case['name']}: herceg refuses ({engine['message']})")
            else:
                matched.add(rule)
        if refused is not None and engine["ok"]:
            place = stricter(case.get("place"))
            if place is None:
                disagreements.append(f"{case['name']}: the schema refuses ({refused})")
            else:
                matched.add(place)
    # A rule's message no spec is refused by is one the schema now says, or
    # one herceg dropped; a place where the schema is stricter, one it no longer is.
    for rule in FIXTURE["unsaid"]:
        for pattern in rule["matches"]:
            if (rule["id"], pattern) not in matched:
                disagreements.append(f"unsaid {rule['id']}: no refusal matches {pattern!r}")
    for rule in FIXTURE["stricter"]:
        for pattern in rule["places"]:
            if (rule["id"], pattern) not in matched:
                disagreements.append(
                    f"stricter {rule['id']}: the schema refuses nothing at {pattern!r}"
                )
    assert not disagreements, "\n".join(disagreements)


def test_each_option_is_probed_in_a_spec_validate_spec_takes(cases):
    """Changes are made of the specs validateSpec takes: every form of every
    place a probe sets (its alternative, but for the value an enumeration
    lists) is set in one, but where the fixture's ``unprobed`` says why not."""
    taken: dict[tuple[str, str], bool] = {}
    for case in cases:
        if case["name"].startswith("probe ") and not case.get("changed"):
            engine = case["engine"]
            took = engine["ok"] or engine["stage"] != "validate"
            form = (case["place"], re.sub(r"=\d+", "", case["alternative"]))
            taken[form] = taken.get(form, False) or took
    unprobed = [(rule["id"], pattern) for rule in FIXTURE["unprobed"] for pattern in rule["places"]]
    missing, matched = [], set()
    for place, form in sorted(form for form, took in taken.items() if not took):
        found = [rule for rule in unprobed if re.fullmatch(rule[1], place)]
        if found:
            matched.update(found)
        else:
            missing.append(f"{place} ({form or 'plain'}): no probe validateSpec takes")
    stale = [
        f"unprobed {rule}: no place left unprobed matches {pattern!r}"
        for rule, pattern in unprobed
        if (rule, pattern) not in matched
    ]
    assert not missing and not stale, "\n".join(missing + stale)


def python_specs() -> list[Any]:
    """The specs Python writes for the shared fixtures' charts."""
    specs = [
        pytest.param(lambda case=case: contract_spec(case), id=f"contracts: {case['name']}")
        for case in CONTRACTS["cases"]
        if "builder" in case and "code" not in case
    ]
    for case in DEFAULTS["defaults"]:
        option = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", case["option"]).lower()
        for given in ({}, {option: case["value"]}, {option: case["other"]}):
            specs.append(
                pytest.param(
                    lambda case=case, given=given: default_chart(case, given).to_spec()[0],
                    id=f"defaults: {case['contract']} {given}",
                )
            )
    return specs


@pytest.mark.parametrize("make", python_specs())
def test_the_specs_python_writes_validate(make):
    spec = make()
    assert refusal({"marks": [], **spec}) is None
