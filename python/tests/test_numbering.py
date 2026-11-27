"""How copies of one data object name its rows, on the side that owns them: the
session fixtures (test/contracts/fixtures/sessions.json) Python runs, with the
same answers as TypeScript's (packages/herceg/test/data/sessions.test.ts), and
randomized histories against a reference."""

from __future__ import annotations

import dataclasses
import json
import os
import random
import re
import threading
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from herceg._errors import ChartError
from herceg._numbering import (
    MAX_ORDINAL,
    Copy,
    Histories,
    History,
    Mutation,
    Revision,
    Rows,
    header_bytes,
    histories,
    merged_update,
    select_operation,
)

FIXTURE = Path(__file__).parents[2] / "test" / "contracts" / "fixtures" / "sessions.json"
CASES = [case for case in json.loads(FIXTURE.read_text())["cases"] if "python" in case["runs"]]


def of_kind(kind: str) -> list[Any]:
    return [pytest.param(case, id=case["name"]) for case in CASES if case["kind"] == kind]


def expand(ranges: list[list[int]]) -> list[int]:
    return [first + i for first, count in ranges for i in range(count)]


def copy_of(spec: dict[str, Any]) -> Copy:
    rows = Rows.of(spec.get("generation", 0), expand(spec["ordinals"]), spec.get("rowOffset", 0))
    return Copy(
        rows,
        revision=spec.get("revision", 0),
        max_rows=spec.get("maxRows"),
        base=spec.get("base"),
        extended_by=spec.get("extendedBy"),
    )


def check(copy: Copy, want: dict[str, Any]) -> None:
    rows = copy.rows
    if "generation" in want:
        assert rows.generation == want["generation"]
    if "ordinals" in want:
        ordinals = expand(want["ordinals"])
        assert rows.ordinals_at().tolist() == ordinals
        assert [rows.ordinal_at(position) for position in range(len(ordinals))] == ordinals
    if "form" in want:
        assert rows.kind == want["form"]
    if "rowOffset" in want:
        assert rows.row_offset == want["rowOffset"]
    if "held" in want:
        assert [list(pair) for pair in rows.held()] == want["held"]
    for ordinal, position in want.get("positions", {}).items():
        assert rows.position_of(int(ordinal)) == position
    if "revision" in want:
        assert copy.revision == want["revision"]
    if "base" in want:
        assert copy.base == want["base"]
    if "extendedBy" in want:
        assert copy.extended_by == want["extendedBy"]


@pytest.mark.parametrize("case", of_kind("numbering"))
def test_numbering(case: dict[str, Any]) -> None:
    copy = copy_of(case["copy"])
    for step in case["steps"]:
        allocator = step.get("allocator", case.get("allocator"))
        if "drop" in step:
            copy = dataclasses.replace(copy, rows=copy.rows.dropped(step["drop"]))
        elif "refused" in step:
            before = copy
            with pytest.raises(ChartError) as refused:
                copy.staged(step["mutations"], allocator)
            assert str(refused.value) == step["refused"]["python"]
            assert refused.value.code == "load-failed"
            assert copy == before
        else:
            copy = copy.staged(step["mutations"], allocator)
        if "expect" in step:
            check(copy, step["expect"])


@pytest.mark.parametrize("case", of_kind("history"))
def test_history(case: dict[str, Any]) -> None:
    history = History(case["data"], case["allocator"])
    copies = {
        name: history.copy(case["snapshot"], options.get("maxRows"))
        for name, options in case["copies"].items()
    }
    for step in case["steps"]:
        name = step["copy"]
        if "make" in step:
            make = step["make"]
            length = make.get("length", case["snapshot"])
            if "refused" in step:
                with pytest.raises(ChartError, match=re.escape(step["refused"]["python"])):
                    history.copy(length)
                continue
            copies[name] = history.copy(length, make.get("maxRows"))
            continue
        if "refused" in step:
            with pytest.raises(ChartError) as refused:
                if "append" in step:
                    history.append(copies[name], step["append"])
                else:
                    history.reset(copies[name], step["reset"])
            assert str(refused.value) == step["refused"]["python"]
            continue
        sent: list[Mutation] = []
        for change in step.get("transaction", [step]):
            done: tuple[Copy, Mutation] | None
            if "append" in change:
                done = history.append(copies[name], change["append"], change.get("maxRows"))
            elif "replace" in change:
                done = history.replace(copies[name], *change["replace"])
            else:
                done = history.reset(copies[name], change["reset"])
            if done is not None:
                copies[name], mutation = done
                sent.append(mutation)
        assert (sent or None) == step["expect"]
    for name, want in case.get("end", {}).items():
        copy = copies[name]
        check(copy, want)
        buffers: list[bytes] = []
        assert copy.spec(buffers) == want["spec"]
        expected = [
            np.array(expand(ranges), dtype="<f8").tobytes() for ranges in want.get("buffers", [])
        ]
        assert buffers == expected


@pytest.mark.parametrize("case", of_kind("registry"))
def test_registry(case: dict[str, Any]) -> None:
    for allocator, want in case["registries"].items():
        registry = Histories(allocator)
        assert registry.data_id(case["digest"]) == want["data"]
        assert [registry.epoch() for _ in want["epochs"]] == want["epochs"]


@pytest.mark.parametrize("case", of_kind("caps"))
def test_caps(case: dict[str, Any]) -> None:
    from herceg._numbering import BUFFER_BYTES, BUFFERS, HEADER_BYTES, OPERATIONS, fits_update

    for limit in case["limits"]:
        fits = fits_update(
            limit.get("headerBytes", 0),
            limit.get("operations", 0),
            limit.get("buffers", 0),
            limit.get("bufferBytes", 0),
        )
        assert fits == (limit["expect"] is None)
    assert (HEADER_BYTES, OPERATIONS, BUFFERS, BUFFER_BYTES) == (2**20, 4096, 8192, 2**26)
    measured = case["measured"]
    assert len(header_bytes(measured["header"])) == measured["bytes"]


def buffer_of(given: Any) -> bytes:
    """A buffer as the fixtures write one: float64 values, or typed ({"int32": [...]})."""
    if isinstance(given, list):
        return np.array(given, dtype="<f8").tobytes()
    if "int32" in given:
        return np.array(given["int32"], dtype="<i4").tobytes()
    return np.array(given["float64"], dtype="<f8").tobytes()


#: A revision of one append whose buffer has as many bytes as a case gives.
SIZED = {
    "op": "append",
    "data": "t",
    "columns": {"v": {"type": "number", "dtype": "float64", "buffer": 0}},
    "first": 0,
    "revision": 1,
}


def revisions_of(given: list[dict[str, Any]]) -> list[Revision]:
    revisions = []
    for spec in given:
        revision = Revision(spec["number"])
        for added in spec.get("add", []):
            revision.add(added["operation"], [buffer_of(b) for b in added.get("buffers", [])])
        for _ in range(spec.get("rules", 0)):
            revision.add({"op": "rule", "id": "r"})
        if "bytes" in spec:
            revision.add(SIZED, [bytes(spec["bytes"])])
        revisions.append(revision)
    return revisions


def header_of(case: dict[str, Any], want: dict[str, Any]) -> dict[str, Any]:
    if "rules" not in want and "bytes" not in want:
        return want
    sizes = want.get("bytes", [])
    descriptors = []
    end = 0
    for size in sizes:
        descriptors.append([end, size])
        end = -(-(end + size) // 8) * 8
    operations = (
        [_sized(index) for index in range(len(sizes))]
        if "bytes" in want
        else [{"op": "rule", "id": "r"}] * want["rules"]
    )
    header = {
        "protocol": 1,
        "kind": "update",
        "stream": case["stream"],
        "epoch": case["epoch"],
        "revision": want["revision"],
        "baseRevision": want["baseRevision"],
        "operations": operations,
        "buffers": descriptors,
    }
    if want.get("more"):
        header["more"] = True
    return header


def _sized(buffer: int) -> dict[str, Any]:
    return {**SIZED, "columns": {"v": {**SIZED["columns"]["v"], "buffer": buffer}}}


@pytest.mark.parametrize("case", of_kind("stream"))
def test_stream(case: dict[str, Any]) -> None:
    revisions = revisions_of(case["revisions"])
    for request in case["requests"]:
        update = merged_update(case["stream"], case["epoch"], revisions, request["since"])
        if request["expect"] is None:
            assert update is None
            continue
        assert update is not None
        header, buffers = update
        assert header == header_of(case, request["expect"])
        if "bytes" in request["expect"]:
            assert [len(buffer) for buffer in buffers] == request["expect"]["bytes"]
        else:
            assert buffers == [buffer_of(given) for given in request.get("buffers", [])]
    alone = case.get("alone")
    if alone:
        assert (
            merged_update(
                case["stream"], case["epoch"], revisions_of(alone["revisions"]), alone["since"]
            )
            is None
        )


def test_a_select_takes_its_revision_and_index():
    revision = Revision(41)
    revision.add({"op": "rule", "id": "r"})
    added = revision.add(select_operation("trips", 0, "", "focus", None))
    assert added["write"] == {"revision": 41, "index": 1}


def test_the_process_registry_draws_its_id_once():
    registry = histories()
    assert registry is histories()
    assert re.fullmatch(r"[0-9a-f]{16}", registry.allocator)
    assert Histories().allocator != Histories().allocator
    assert registry.data_id("9f2c") == f"9f2c@{registry.allocator}"


def reference_runs(ordinals: list[int]) -> int:
    """How many runs of ordinals following on a copy's rows make."""
    return sum(1 for i, ordinal in enumerate(ordinals) if i == 0 or ordinal != ordinals[i - 1] + 1)


@pytest.mark.parametrize("seed", range(40))
def test_copies_of_a_history_follow_a_reference(seed: int) -> None:
    # Two to four copies of one history: each takes appends (some with a
    # window), replacements, and resets numbered by the history, as the
    # owner orders them; its rows by position match a reference of plain
    # lists, every form within 8 bytes a row and as the rule picks it.
    generator = random.Random(seed)
    history = History("trips", "a1")
    snapshot = generator.randrange(0, 40)
    names = [f"w{i}" for i in range(generator.randrange(2, 5))]
    windows = {name: generator.choice([None, None, 12, 30]) for name in names}
    copies = {name: history.copy(snapshot, windows[name]) for name in names}
    reference = {
        name: (
            0,
            list(range(snapshot))[-windows[name] :] if windows[name] else list(range(snapshot)),
        )
        for name in names
    }
    for _ in range(120):
        name = generator.choice(names)
        copy = copies[name]
        generation, rows = reference[name]
        roll = generator.random()
        if roll < 0.6:
            count = generator.randrange(0, 6)
            window = generator.choice([None, None, None, 8, 20])
            done = history.append(copy, count, window)
            if done is None:
                assert count == 0
                continue
            copies[name], mutation = done
            rows = rows + list(range(mutation["first"], mutation["first"] + count))
            limits = [n for n in (windows[name], window) if n is not None]
            if limits:
                rows = rows[-min(limits) :]
        elif roll < 0.8 and rows:
            start = generator.randrange(0, len(rows))
            copies[name], _ = history.replace(
                copy, start, generator.randrange(0, len(rows) - start + 1)
            )
        elif roll < 0.9:
            count = generator.randrange(0, 15)
            copies[name], mutation = history.reset(copy, count)
            generation = mutation["generation"]
            kept = count if windows[name] is None else min(count, windows[name])
            rows = list(range(count - kept, count))
        else:
            continue
        reference[name] = (generation, rows)
        now = copies[name].rows
        assert now.generation == generation
        assert now.ordinals_at().tolist() == rows
        assert now.byte_length <= 8 * len(rows)
        runs = reference_runs(rows)
        if runs <= 1:
            assert now.kind == "offset"
        elif now.kind == "runs":
            assert 3 * runs <= len(rows)
        else:
            assert 6 * runs > len(rows)
        for position, ordinal in enumerate(rows):
            assert now.ordinal_at(position) == ordinal
            assert now.position_of(ordinal) == position
    # Each append went to one copy, so beyond the snapshot no two copies of a
    # generation hold one ordinal: the history numbered each append once.
    beyond: dict[int, list[int]] = {}
    for generation, rows in reference.values():
        beyond.setdefault(generation, []).extend(
            ordinal for ordinal in rows if generation > 0 or ordinal >= snapshot
        )
    for ordinals in beyond.values():
        assert len(ordinals) == len(set(ordinals))


def test_the_bytes_each_numbering_form_keeps():
    # An offset keeps nothing; runs 24 bytes each, at most a third as many as
    # rows; an ordinals column 8 bytes a row: never more than 8 bytes a row.
    rows = Rows.numbered(0, 0, 1_000_000)
    assert rows.byte_length == 0
    interleaved = rows
    for k in range(1000):
        interleaved = interleaved.appended(2_000_000 + 10 * k, 5)
    assert interleaved.kind == "runs" and interleaved.runs is not None
    assert interleaved.runs.dtype == np.int64 and interleaved.runs.nbytes == 24 * 1001
    assert interleaved.byte_length == interleaved.runs.nbytes
    column = Rows.numbered(0, 0, 0)
    for k in range(300):
        column = column.appended(10 * k, 2)
    assert column.kind == "ordinals" and column.ordinals is not None
    assert column.ordinals.dtype == np.float64 and column.byte_length == 8 * 600


def test_a_whole_append_dropped_by_its_window_numbers_every_row():
    # A window of 3 keeps a batch's last rows; the rows it drops at once were
    # numbered all the same, so the next append starts past them.
    history = History("trips", "a1")
    copy = history.copy(2, max_rows=3)
    done = history.append(copy, 10)
    assert done is not None
    copy, mutation = done
    assert mutation["first"] == 2
    assert copy.rows.ordinals_at().tolist() == [9, 10, 11]
    done = history.append(copy, 1)
    assert done is not None and done[1]["first"] == 12


def test_ordinals_at_the_largest_safe_integer_stay_exact():
    rows = Rows.numbered(0, MAX_ORDINAL - 1, 2)
    assert rows.ordinal_at(1) == MAX_ORDINAL
    assert rows.ordinals_at().tolist() == [MAX_ORDINAL - 1, MAX_ORDINAL]
    assert rows.position_of(MAX_ORDINAL) == 1


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs fork")
def test_a_forked_process_does_not_allocate_through_its_parents_histories():
    # Parent and child would give one ordinal twice under one allocator, and
    # nothing where their copies meet could tell.
    history = Histories().history("trips")
    copy = history.copy(10)
    read, write = os.pipe()
    child = os.fork()
    if child == 0:  # pragma: no cover - runs in the child
        try:
            history.append(copy, 1)
            message = b"allocated"
        except ChartError as error:
            message = str(error).encode()
        os.write(write, message)
        os._exit(0)
    os.close(write)
    os.waitpid(child, 0)
    with os.fdopen(read, "rb") as received:
        message = received.read().decode()
    assert message == (
        "history 'trips': it was made in another process, which allocates its rows; a forked "
        "process makes its own charts, and its histories() names them"
    )
    done = history.append(copy, 1)
    assert done is not None and done[1]["first"] == 10


@pytest.mark.skipif(not hasattr(os, "fork"), reason="needs fork")
def test_a_forked_process_does_not_name_data_through_its_parents_registry():
    # A registry kept from before the fork would make histories and epochs
    # under the parent's allocator in both processes.
    registry = Histories()
    read, write = os.pipe()
    child = os.fork()
    if child == 0:  # pragma: no cover - runs in the child
        refused = []
        for use in (
            lambda: registry.history("new-trips"),
            registry.epoch,
            lambda: registry.data_id("9f"),
        ):
            try:
                use()
            except ChartError as error:
                refused.append(str(error))
        fresh = histories().allocator != registry.allocator
        os.write(write, json.dumps({"refused": refused, "fresh": fresh}).encode())
        os._exit(0)
    os.close(write)
    os.waitpid(child, 0)
    with os.fdopen(read, "rb") as received:
        report = json.loads(received.read())
    message = (
        f"histories {registry.allocator}: made in another process, whose allocator it is; a "
        "forked process names its data with its own, histories()"
    )
    assert report == {"refused": [message] * 3, "fresh": True}
    assert registry.epoch() == f"{registry.allocator}:1"


def test_threads_appending_to_one_history_never_share_ordinals():
    # Copies whose staging is slow (ordinals columns) appended to from several
    # threads at once: each append's ordinals are its own.
    history = History("trips", "a1")
    snapshot = history.copy(3_000)
    column = Copy(
        Rows.of(0, np.concatenate([np.arange(0, 3_000, 2), np.arange(1, 3_000, 2)])),
        base=3_000,
    )
    assert column.rows.kind == "ordinals"
    firsts: list[int] = []

    def append(copy: Copy) -> None:
        for _ in range(60):
            done = history.append(copy, 1)
            assert done is not None
            copy = done[0]
            firsts.append(done[1]["first"])

    workers = [threading.Thread(target=append, args=(copy,)) for copy in (snapshot, column) * 4]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    assert sorted(firsts) == list(range(3_000, 3_000 + 8 * 60))
