"""How copies of one data object name its rows, on the side that owns them.

A source row is named, wherever it travels, by its history's data id, a
generation, and an ordinal. Each Python process has one history registry
(``histories()``), the only allocator of the histories it names, with an id
drawn at random: it gives each logical append its ordinals once and each
reset a newer generation. Every copy (a widget's table, a stream's) is
numbered by the mutations it is sent, in the same forms as the browser's
copies, so Python writes a copy's numbering into its snapshot and maps its
positions to ordinals. This module also writes the update envelope's headers:
a stream's server writes keep the revision and index that wrote them, through
merged responses and snapshots.

The same contract as herceg's ``data/numbering.ts`` and ``web/envelope.ts``;
``test/contracts/fixtures/sessions.json`` holds the cases both answer.
Selections are shared in the browser, so Python merges no channel states.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal, TypedDict

import numpy as np

from ._errors import ChartError

#: The largest ordinal: JavaScript's largest safe integer, which float64 buffers carry exactly.
MAX_ORDINAL = 2**53 - 1
#: What one update response carries at most: its JSON header's UTF-8 bytes,
#: its operations, its buffer descriptors, and its buffers' bytes, which the
#: browser materializes.
HEADER_BYTES = 2**20
OPERATIONS = 4096
BUFFERS = 8192
BUFFER_BYTES = 2**26
PROTOCOL = 1

Kind = Literal["offset", "runs", "ordinals"]


class _Mutation(TypedDict):
    op: Literal["append", "replace", "reset"]
    count: int
    revision: int


class Mutation(_Mutation, total=False):
    """A numbered mutation of one copy, with its rows' count where the envelope
    carries their columns, and the copy's revision after it: an append's
    ``first`` ordinal and ``maxRows``, a replacement's ``start``, a reset's newer
    ``generation``."""

    first: int
    maxRows: int
    start: int
    generation: int


@dataclass(frozen=True)
class Rows:
    """How a copy's rows map to ordinals of one generation: one run (``offset``,
    the row at position p numbered ``first + p``); ``runs``, flat triples of a
    local identity, its ordinal, and a count, in ascending identities, where
    other copies' appends left gaps; or each row's ordinal by position
    (``ordinals``) once runs would take more room. ``row_offset`` is the
    identity of the row at position 0, which runs are keyed from."""

    generation: int
    kind: Kind
    row_offset: int
    length: int
    first: int = 0
    runs: np.ndarray | None = field(default=None, compare=False)
    ordinals: np.ndarray | None = field(default=None, compare=False)

    @classmethod
    def numbered(cls, generation: int, first: int, length: int, row_offset: int = 0) -> Rows:
        """``length`` rows numbered on from ``first``."""
        return cls(generation, "offset", row_offset, length, first if length else 0)

    @classmethod
    def of(cls, generation: int, ordinals: Any, row_offset: int = 0) -> Rows:
        """Rows whose ordinals, by position, are ``ordinals``."""
        values = np.asarray(ordinals, dtype=np.float64)
        return _settled(generation, row_offset, len(values), _column_runs(values, row_offset))

    def ordinal_at(self, position: int) -> int | None:
        """The ordinal of the row at ``position``; None for no row there."""
        if not 0 <= position < self.length:
            return None
        if self.kind == "offset":
            return self.first + position
        if self.kind == "ordinals":
            assert self.ordinals is not None
            return int(self.ordinals[position])
        assert self.runs is not None
        identity = self.row_offset + position
        # The last run starting at or before the identity holds it.
        starts = self.runs[0::3]
        k = 3 * (int(np.searchsorted(starts, identity, side="right")) - 1)
        return int(self.runs[k + 1]) + (identity - int(self.runs[k]))

    def position_of(self, ordinal: int) -> int:
        """Where the row numbered ``ordinal`` is; -1 when the copy holds none."""
        if self.kind == "offset":
            position = ordinal - self.first
            return position if 0 <= position < self.length else -1
        if self.kind == "ordinals":
            assert self.ordinals is not None
            found = np.flatnonzero(self.ordinals == ordinal)
            return int(found[0]) if len(found) else -1
        assert self.runs is not None
        for k in range(0, len(self.runs), 3):
            identity, first, count = (int(value) for value in self.runs[k : k + 3])
            if first <= ordinal < first + count:
                return identity - self.row_offset + ordinal - first
        return -1

    def ordinals_at(self) -> np.ndarray:
        """Every row's ordinal, by position, as float64."""
        if self.kind == "ordinals":
            assert self.ordinals is not None
            return self.ordinals.copy()
        return _column(self.row_offset, self.length, _runs_of(self))

    def held(self) -> list[tuple[int, int]]:
        """The ordinals held, as (first, count) ranges, ascending, those that touch joined."""
        runs = _runs_of(self)
        held: list[tuple[int, int]] = []
        for first, count in sorted((runs[k + 1], runs[k + 2]) for k in range(0, len(runs), 3)):
            if held and held[-1][0] + held[-1][1] == first:
                held[-1] = (held[-1][0], held[-1][1] + count)
            else:
                held.append((first, count))
        return held

    def appended(self, first: int, count: int, limit: int | None = None) -> Rows:
        """The rows after ``count`` rows numbered from ``first``, keeping at most
        ``limit``: rows past it leave from the first, batch rows included."""
        runs = _runs_of(self)
        _extend(runs, self.row_offset + self.length, first, count)
        length = self.length + count
        excess = max(0, length - limit) if limit is not None else 0
        offset = self.row_offset + excess
        return _settled(self.generation, offset, length - excess, _trimmed(runs, offset), self.kind)

    def dropped(self, count: int) -> Rows:
        """The rows after dropping the first ``count``."""
        drop = min(count, self.length)
        offset = self.row_offset + drop
        return _settled(
            self.generation, offset, self.length - drop, _trimmed(_runs_of(self), offset), self.kind
        )

    @property
    def byte_length(self) -> int:
        """What the numbering keeps: 24 bytes a run, 8 a row of an ordinals
        column, none for an offset."""
        if self.kind == "ordinals":
            assert self.ordinals is not None
            return int(self.ordinals.nbytes)
        return 0 if self.runs is None else int(self.runs.nbytes)


@dataclass(frozen=True)
class Copy:
    """A copy of a history's rows, as its owner records it: its numbering, what
    it knows of how its generation was allocated (the rows it began with, and
    the allocator that extended it), its count of its own mutations, and its
    table's own ``max_rows``."""

    rows: Rows
    revision: int = 0
    max_rows: int | None = None
    base: int | None = None
    extended_by: str | None = None

    def staged(self, mutations: Sequence[Mutation], allocator: str | None = None) -> Copy:
        """The copy after ``mutations`` from ``allocator``, each checked first;
        this copy is not changed, so a refused one leaves it as it was."""
        copy = self
        for index, mutation in enumerate(mutations):
            copy = copy._applied(mutation, f"operations[{index}] {mutation['op']}", allocator)
        return copy

    def spec(self, buffers: list[bytes]) -> dict[str, Any]:
        """The numbering as a spec's columns entry carries it beside the rows: an
        ordinals column as a float64 buffer appended to ``buffers``."""
        rows = self.rows
        spec: dict[str, Any] = {"generation": rows.generation}
        if rows.kind == "offset":
            spec["ordinals"] = rows.first
        else:
            spec["ordinals"] = {"buffer": len(buffers)}
            buffers.append(rows.ordinals_at().astype("<f8").tobytes())
        if self.base is not None:
            spec["base"] = self.base
        if self.extended_by is not None:
            spec["extendedBy"] = self.extended_by
        return spec

    def _applied(self, mutation: Mutation, at: str, allocator: str | None) -> Copy:
        rows = self.rows
        revision = mutation["revision"]
        if revision != self.revision + 1:
            raise ChartError(
                f"{at} revision: {_shown(revision)} does not follow this copy's revision "
                f"{_shown(self.revision)}, so it missed a mutation; load the snapshot again",
                code="load-failed",
                phase="load",
            )
        count = mutation["count"]
        if mutation["op"] == "replace":
            start = mutation["start"]
            _whole(start, at, "start")
            _whole(count, at, "count")
            if start + count > rows.length:
                verb = "pass" if count > 1 else "passes"
                raise _refused(
                    f"{at}: {_range('rows', start, max(count, 1))} {verb} this copy's "
                    f"{_shown(rows.length)} rows; replace rows the copy holds"
                )
            return replace(self, revision=revision)
        if mutation["op"] == "reset":
            generation = mutation["generation"]
            if not (_is_whole(generation) and generation > rows.generation):
                raise _refused(
                    f"{at} generation: {_shown(generation)} is not newer than this copy's "
                    f"generation {_shown(rows.generation)}; reset to a newer generation, which "
                    "the history's owner gives"
                )
            _whole(count, at, "count")
            kept = count if self.max_rows is None else min(count, self.max_rows)
            return replace(
                self,
                rows=Rows.numbered(generation, count - kept, kept, count - kept),
                revision=revision,
                base=count,
                extended_by=allocator,
            )
        first = mutation["first"]
        max_rows = mutation.get("maxRows")
        _whole(first, at, "first")
        _whole(count, at, "count")
        if max_rows is not None and not (_is_whole(max_rows) and max_rows > 0):
            raise _refused(f"{at} max_rows: expected a positive whole number; received {max_rows}")
        limits = [n for n in (self.max_rows, max_rows) if n is not None]
        limit = min(limits) if limits else None
        if count == 0:
            excess = max(0, rows.length - limit) if limit is not None else 0
            return replace(self, rows=rows.dropped(excess), revision=revision)
        if first + count - 1 > MAX_ORDINAL:
            raise _refused(
                f"{at}: {_range('ordinals', first, count)} pass the largest safe integer "
                f"({_shown(MAX_ORDINAL)}); reset the table to start a new generation"
            )
        for held_first, held_count in rows.held():
            if held_first < first + count and first < held_first + held_count:
                verb = "overlap" if count > 1 else "overlaps"
                raise _refused(
                    f"{at}: {_range('ordinals', first, count)} {verb} "
                    f"{_range('ordinals', held_first, held_count)}, which this copy holds in "
                    f"generation {_shown(rows.generation)}; give each history one owner, which "
                    "numbers each append once"
                )
        if allocator is not None and self.extended_by not in (None, allocator):
            raise _refused(
                f'{at}: numbered by allocator "{allocator}", but "{self.extended_by}" extended '
                f"this copy's generation {_shown(rows.generation)}; give each history one owner, "
                "which numbers each append once"
            )
        return replace(
            self,
            rows=rows.appended(first, count, limit),
            revision=revision,
            extended_by=self.extended_by if self.extended_by is not None else allocator,
        )


@dataclass
class _Generation:
    base: int
    next: int


class History:
    """One history's allocation: a generation counter, and for each generation
    the rows it began with and the next ordinal, kept while copies of it may
    still append (copies of an older generation keep sharing among themselves).
    It numbers mutations of copies, which their owners keep, one at a time
    (threads of one process share it). Only the process that made it
    allocates: a forked child that inherited it refuses, since parent and
    child would give one ordinal twice."""

    def __init__(self, data: str, allocator: str) -> None:
        self.data = data
        self.allocator = allocator
        self.latest = 0
        self._generations: dict[int, _Generation] = {}
        self._process = os.getpid()
        self._lock = threading.Lock()

    def copy(self, length: int, max_rows: int | None = None) -> Copy:
        """A copy of the snapshot the history began with: its ``length`` rows
        numbered from 0, as every copy of it numbers them."""
        # Checked before the lock, which a forked child may inherit held.
        self._owned()
        with self._lock:
            return self._copy(length, max_rows)

    def _copy(self, length: int, max_rows: int | None) -> Copy:
        _whole(length, f"history {self.data!r} copy", "length")
        if max_rows is not None and not (_is_whole(max_rows) and max_rows > 0):
            raise ChartError(
                f"history {self.data!r} copy max_rows: expected a positive whole number; "
                f"received {max_rows}"
            )
        began = self._generations.get(0)
        if began is not None and began.base != length:
            raise ChartError(
                f"history {self.data!r}: its snapshot has {began.base:,} rows, and this copy "
                f"{length:,}; give different data different ids (hg.data(..., id=...))"
            )
        if began is None:
            self._generations[0] = _Generation(length, length)
        kept = length if max_rows is None else min(length, max_rows)
        rows = Rows.numbered(0, length - kept, kept, length - kept)
        return Copy(rows, max_rows=max_rows, base=length)

    def append(
        self, copy: Copy, count: int, max_rows: int | None = None
    ) -> tuple[Copy, Mutation] | None:
        """Numbers an append of ``count`` rows to ``copy``, every row ``max_rows``
        drops included: the copy after it, and the mutation to send it. None for
        no rows, which change nothing."""
        self._owned()
        with self._lock:
            return self._append(copy, count, max_rows)

    def _append(self, copy: Copy, count: int, max_rows: int | None) -> tuple[Copy, Mutation] | None:
        if count == 0:
            return None
        generation = self._generations[copy.rows.generation]
        first = generation.next
        if _is_whole(count) and count - 1 > MAX_ORDINAL - first:
            raise ChartError(
                f"history {self.data!r}: an append of {count:,} rows passes the largest "
                f"ordinal ({MAX_ORDINAL:,}); replace the rows, which starts a new generation"
            )
        mutation: Mutation = {
            "op": "append",
            "first": first,
            "count": count,
            "revision": copy.revision + 1,
        }
        if max_rows is not None:
            mutation["maxRows"] = max_rows
        # Checked whole before the history moves on, so a refusal takes no ordinals.
        staged = copy.staged([mutation], self.allocator)
        generation.next += count
        return staged, mutation

    def replace(self, copy: Copy, start: int, count: int) -> tuple[Copy, Mutation]:
        """Rows edited in place, which keep their ordinals."""
        self._owned()
        with self._lock:
            mutation: Mutation = {
                "op": "replace",
                "start": start,
                "count": count,
                "revision": copy.revision + 1,
            }
            return copy.staged([mutation], self.allocator), mutation

    def reset(self, copy: Copy, count: int) -> tuple[Copy, Mutation]:
        """Every row of ``copy`` replaced by ``count`` rows: a newer generation,
        whose rows are numbered from 0."""
        self._owned()
        with self._lock:
            return self._reset(copy, count)

    def _reset(self, copy: Copy, count: int) -> tuple[Copy, Mutation]:
        mutation: Mutation = {
            "op": "reset",
            "generation": self.latest + 1,
            "count": count,
            "revision": copy.revision + 1,
        }
        staged = copy.staged([mutation], self.allocator)
        self.latest += 1
        self._generations[self.latest] = _Generation(count, count)
        return staged, mutation

    def _owned(self) -> None:
        if os.getpid() != self._process:
            raise ChartError(
                f"history {self.data!r}: it was made in another process, which allocates its "
                "rows; a forked process makes its own charts, and its histories() names them"
            )


class Histories:
    """A process's history registry: the one allocator of the histories it
    names, with an id of 64 random bits, never derived from the host or the
    user. A restarted process has another, so it never extends what its
    predecessor gave."""

    def __init__(self, allocator: str | None = None) -> None:
        self.allocator = allocator if allocator is not None else secrets.token_hex(8)
        self._histories: dict[str, History] = {}
        self._epochs = 0
        self._process = os.getpid()
        self._lock = threading.Lock()

    def data_id(self, digest: str) -> str:
        """The data id of a snapshot this process names by its digest."""
        self._owned()
        return f"{digest}@{self.allocator}"

    def history(self, data: str) -> History:
        """The history of a data id, made on first use."""
        self._owned()
        with self._lock:
            history = self._histories.get(data)
            if history is None:
                history = self._histories[data] = History(data, self.allocator)
            return history

    def epoch(self) -> str:
        """A new epoch for a stream this process owns."""
        self._owned()
        with self._lock:
            self._epochs += 1
            return f"{self.allocator}:{self._epochs}"

    def _owned(self) -> None:
        if os.getpid() != self._process:
            raise ChartError(
                f"histories {self.allocator}: made in another process, whose allocator it is; "
                "a forked process names its data with its own, histories()"
            )


_registry: Histories | None = None


_registry_lock = threading.Lock()


def histories() -> Histories:
    """This process's registry, made on first use."""
    global _registry
    with _registry_lock:
        if _registry is None:
            _registry = Histories()
        return _registry


def _forget_registry() -> None:
    # A forked child is another process: it draws its own allocator id. Its
    # lock is new, since a thread of the parent may have held the old one.
    global _registry, _registry_lock
    _registry = None
    _registry_lock = threading.Lock()


if hasattr(os, "register_at_fork"):
    os.register_at_fork(after_in_child=_forget_registry)


class Revision:
    """One transaction of a stream: its operations in order and the buffers they
    reference. A ``select`` added to it is a server's write, named by the
    revision and its index in it wherever it travels."""

    def __init__(self, number: int) -> None:
        self.number = number
        self.operations: list[dict[str, Any]] = []
        self.buffers: list[bytes] = []

    def add(self, operation: dict[str, Any], buffers: Sequence[bytes] = ()) -> dict[str, Any]:
        """Adds ``operation``, whose buffer references index ``buffers``."""
        added = _renumbered(operation, len(self.buffers))
        self.buffers.extend(buffers)
        if added["op"] == "select":
            added["write"] = {"revision": self.number, "index": len(self.operations)}
        self.operations.append(added)
        return added


def select_operation(
    data: str, generation: int, namespace: str, channel: str, selection: dict[str, Any] | None
) -> dict[str, Any]:
    """A stream's write of a channel: a clear (None), a predicate, or rows
    (``{"kind": "rows", "ordinals": {"buffer": 0}}``)."""
    return {
        "op": "select",
        "data": data,
        "generation": generation,
        "namespace": namespace,
        "channel": channel,
        "selection": selection,
    }


def merged_update(
    stream: str, epoch: str, revisions: Sequence[Revision], since: int
) -> tuple[dict[str, Any], list[bytes]] | None:
    """The update from revision ``since`` on: whole revisions in order, as many
    as fit an update's limits, ``more`` when others follow. None when the
    stream must answer with a snapshot instead: the revision after ``since`` is
    not kept, or alone passes the limits."""
    pending = [revision for revision in revisions if revision.number > since]
    if not pending or pending[0].number != since + 1:
        return None
    operations: list[dict[str, Any]] = []
    buffers: list[bytes] = []
    best: tuple[dict[str, Any], list[bytes]] | None = None
    for count, revision in enumerate(pending, 1):
        operations = operations + [_renumbered(op, len(buffers)) for op in revision.operations]
        buffers = buffers + revision.buffers
        header = {
            "protocol": PROTOCOL,
            "kind": "update",
            "stream": stream,
            "epoch": epoch,
            "revision": revision.number,
            "baseRevision": since,
            "operations": operations,
            "buffers": _descriptors(buffers),
        }
        if count < len(pending):
            header["more"] = True
        size = sum(len(buffer) for buffer in buffers)
        if not fits_update(len(header_bytes(header)), len(operations), len(buffers), size):
            break
        best = header, buffers
    return best


def snapshot_header(
    stream: str,
    epoch: str,
    revision: int,
    spec: dict[str, Any],
    channels: Sequence[dict[str, Any]],
    buffers: Sequence[bytes],
) -> dict[str, Any]:
    """A snapshot's header: the stream's spec, its tables' numbering in their
    columns entries, and each channel's state with the position in ``epoch`` of
    the write that made it (``{"revision", "index"}``)."""
    return {
        "protocol": PROTOCOL,
        "kind": "snapshot",
        "stream": stream,
        "epoch": epoch,
        "revision": revision,
        "spec": spec,
        "channels": list(channels),
        "buffers": _descriptors(list(buffers)),
    }


def header_bytes(header: dict[str, Any]) -> bytes:
    """A header as the envelope carries it: compact UTF-8 JSON, as browsers write it."""
    return json.dumps(header, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def fits_update(header_length: int, operations: int, buffers: int, buffer_bytes: int = 0) -> bool:
    """Whether an update of these sizes is within what one response carries."""
    return (
        header_length <= HEADER_BYTES
        and operations <= OPERATIONS
        and buffers <= BUFFERS
        and buffer_bytes <= BUFFER_BYTES
    )


#: The fields of each kind of column spec that may name a buffer: the rest,
#: and inline arrays, hold values.
_BUFFER_FIELDS = {
    "number": ("buffer",),
    "time": ("buffer",),
    "category": ("codes",),
    "geometry": ("coordinates", "ringOffsets", "polygonOffsets", "geometryOffsets", "codes"),
}


def _renumbered(operation: dict[str, Any], by: int) -> dict[str, Any]:
    """The operation with each buffer its columns and selection name moved by ``by``."""

    def moved(spec: Any, fields: Sequence[str]) -> Any:
        if not isinstance(spec, dict):
            return spec
        return {
            key: value + by if key in fields and isinstance(value, int) else value
            for key, value in spec.items()
        }

    renumbered = dict(operation)
    columns = operation.get("columns")
    if isinstance(columns, dict):
        renumbered["columns"] = {
            name: moved(spec, _BUFFER_FIELDS.get(str(spec.get("type")), ()))
            if isinstance(spec, dict)
            else spec
            for name, spec in columns.items()
        }
    selection = operation.get("selection")
    if isinstance(selection, dict) and selection.get("kind") == "rows":
        renumbered["selection"] = {
            **selection,
            "ordinals": moved(selection["ordinals"], ("buffer",)),
        }
    return renumbered


def _descriptors(buffers: Sequence[bytes]) -> list[list[int]]:
    """Each buffer's offset from the first, aligned to 8 bytes, and its length."""
    out = []
    end = 0
    for buffer in buffers:
        out.append([end, len(buffer)])
        end = -(-(end + len(buffer)) // 8) * 8
    return out


def _runs_of(rows: Rows) -> list[int]:
    if rows.kind == "runs":
        assert rows.runs is not None
        return [int(value) for value in rows.runs]
    if rows.kind == "offset":
        return [rows.row_offset, rows.first, rows.length] if rows.length else []
    assert rows.ordinals is not None
    return _column_runs(rows.ordinals, rows.row_offset)


def _column_runs(ordinals: np.ndarray, row_offset: int) -> list[int]:
    """The runs of an ordinals column: where each next row's ordinal follows on."""
    if len(ordinals) == 0:
        return []
    starts = np.concatenate([[0], np.flatnonzero(np.diff(ordinals) != 1) + 1])
    counts = np.diff(np.concatenate([starts, [len(ordinals)]]))
    runs: list[int] = []
    for start, count in zip(starts.tolist(), counts.tolist(), strict=True):
        runs += [row_offset + start, int(ordinals[start]), count]
    return runs


def _extend(runs: list[int], identity: int, ordinal: int, count: int) -> None:
    if count == 0:
        return
    if runs and runs[-3] + runs[-1] == identity and runs[-2] + runs[-1] == ordinal:
        runs[-1] += count
    else:
        runs += [identity, ordinal, count]


def _trimmed(runs: list[int], start: int) -> list[int]:
    k = 0
    while k < len(runs) and runs[k] + runs[k + 2] <= start:
        k += 3
    out = runs[k:]
    if out and out[0] < start:
        cut = start - out[0]
        out[0:3] = [start, out[1] + cut, out[2] - cut]
    return out


def _column(row_offset: int, length: int, runs: list[int]) -> np.ndarray:
    out = np.empty(length, dtype=np.float64)
    for k in range(0, len(runs), 3):
        at = runs[k] - row_offset
        out[at : at + runs[k + 2]] = np.arange(runs[k + 1], runs[k + 1] + runs[k + 2])
    return out


def _settled(
    generation: int, row_offset: int, length: int, runs: list[int], before: Kind | None = None
) -> Rows:
    """Rows in their numbering's form: one run is an offset; runs while there are
    at most a third as many as rows (24 bytes a run against 8 a row); past that
    an ordinals column, which goes back to runs only at a sixth."""
    count = len(runs) // 3
    if count <= 1:
        return Rows.numbered(generation, runs[1] if count else 0, length, row_offset)
    column = 6 * count > length if before == "ordinals" else 3 * count > length
    if not column:
        packed = np.array(runs, dtype=np.int64)
        packed.flags.writeable = False
        return Rows(generation, "runs", row_offset, length, runs=packed)
    ordinals = _column(row_offset, length, runs)
    ordinals.flags.writeable = False
    return Rows(generation, "ordinals", row_offset, length, ordinals=ordinals)


def _is_whole(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_ORDINAL


def _whole(value: Any, at: str, name: str) -> None:
    if not _is_whole(value):
        raise _refused(f"{at} {name}: expected a whole number of 0 or more; received {value}")


def _range(noun: str, first: int, count: int) -> str:
    return (
        f"{noun[:-1]} {_shown(first)}"
        if count == 1
        else f"{noun} {_shown(first)} to {_shown(first + count - 1)}"
    )


def _shown(value: Any) -> str:
    return f"{value:,}" if isinstance(value, int) and not isinstance(value, bool) else str(value)


def _refused(message: str) -> ChartError:
    return ChartError(message, code="load-failed", phase="load")
