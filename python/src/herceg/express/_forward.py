"""The mark options express functions forward to their primary mark:
``z_index``, ``encode``, and ``labels``, as the chart's marks take them,
and the tables the plot's marks draw, which ``Outputs`` owns.

The options read the data's columns, and x, y, the series, and the facets
as the plot computes them (y's estimate, say); never other columns the
plot computes (counts, an interval's ends, densities), whose names are
the plot's to choose. A recipe drawing its data's rows (stripplot,
swarmplot) carries a column it reads row for row. One drawing a summary
of groups of rows (an estimate, a density, a fit) carries a column only
where it has one value in each group, and otherwise refuses with what to
do instead: a summary has no single row to read a varying column of.

Only the primary mark takes the options. Marks standing for the same
series beside it (a line's band, a fit's points) take its color binding,
a field or the series through a scale, so the series' colors come from
one scale; a color it gives otherwise (a condition, a constant) is its
own, and they, like error bars, which take no channels, are drawn in a
neutral color beside it rather than in series colors that would
contradict it. A mark standing in for the primary one (an ECDF's point
where a group has one value) takes its color channel and depth whole.
"""

from __future__ import annotations

import math
from collections.abc import Collection, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .._data import Column
from .._encoding import (
    BarLabels,
    Encodings,
    SeriesLabels,
    encodings_spec,
    label_dict_problem,
)
from .._errors import ChartError, is_number, listed, shown
from .._style import _built
from ._common import Grouping, Levels, Source, fresh


@dataclass(frozen=True)
class MarkOptions:
    """What an express function forwards to its primary mark, checked, with
    the columns its ``encode`` and ``labels`` read, each with the option
    reading it, and the color channel as the spec writes it."""

    function: str
    z_index: float | None = None
    encode: Encodings | None = None
    labels: Any = None
    reads: Mapping[str, str] = field(default_factory=dict)
    color: Mapping[str, Any] | None = None
    item_key: str | None = None

    def primary(self) -> dict[str, Any]:
        """The primary mark's keywords."""
        given = {
            "z_index": self.z_index,
            "encode": self.encode,
            "labels": self.labels,
            "item_key": self.item_key,
        }
        return {name: value for name, value in given.items() if value is not None}

    @property
    def colored(self) -> bool:
        """Whether the primary mark's color is a channel of its own."""
        return self.color is not None

    @property
    def bound(self) -> str | None:
        """The column the color channel binds through a scale, if any."""
        return None if self.color is None else self.color.get("field")

    def supporting(
        self, table: Mapping[str, Column], neutral: str, option: str = "color"
    ) -> dict[str, Any]:
        """The keywords of marks standing for the same series beside the
        primary one, drawing `table`: its color binding (a field or the
        series through a scale), or `neutral` paint, as the mark's `option`
        for one color (points' ``fill``), beside a color of its own (a
        condition, a constant)."""
        if self.color is None or self.encode is None:
            return {}
        if "field" not in self.color and "series" not in self.color:
            return {option: neutral}
        if self.bound is not None and self.bound not in table:
            raise RuntimeError(f"{self.function}: a table beside the primary lacks {self.bound!r}")
        return {"encode": Encodings(color=self.encode.color)}

    def stand_in(self) -> dict[str, Any]:
        """The keywords of a mark standing in for the primary one where it
        cannot draw (an ECDF's point for a group of one value): its depth
        and its color channel, whole."""
        out: dict[str, Any] = {} if self.z_index is None else {"z_index": self.z_index}
        if self.encode is not None and self.encode.color is not None:
            out["encode"] = Encodings(color=self.encode.color)
        return out

    def refuse(self, option: str, reason: str) -> None:
        """Refuses `option` where it was given, for `reason` ("problem; correction")."""
        if getattr(self, option) is not None:
            raise ChartError(f"{self.function} {option}: {reason}", path=option)


def mark_options(
    function: str,
    *,
    z_index: float | None = None,
    encode: Any = None,
    labels: Any = None,
    channels: Sequence[str] = (),
    labels_of: type[SeriesLabels] | type[BarLabels] | None = None,
    edges: bool = False,
    item_key: str | None = None,
) -> MarkOptions:
    """The mark options `function` was given, checked as its primary mark
    checks them: `channels` its ``encode`` takes, `labels_of`, the labels
    it draws (none without), which follow a band's edge where `edges` (an
    area's) and the line otherwise, and the column naming its rows' items
    (`item_key`, for functions whose mark draws rows)."""
    if z_index is not None and (
        isinstance(z_index, bool) or not is_number(z_index) or not math.isfinite(z_index)
    ):
        raise ChartError(
            f"{function} z_index: expected a finite number, where the plot's mark is painted "
            f"among its panel's marks; received {shown(z_index)}",
            path="z_index",
        )
    built: Encodings | None = None
    reads: dict[str, str] = {}
    color: Mapping[str, Any] | None = None
    if item_key is not None:
        if not isinstance(item_key, str):
            raise ChartError(
                f"{function} item_key: expected a column's name; received {shown(item_key)}",
                path="item_key",
            )
        reads[item_key] = "item_key"
    if encode is not None:
        if not channels:
            raise ChartError(
                f"{function} encode: its marks take no channels; drop encode", path="encode"
            )
        spec = encodings_spec(encode, channels, function)
        for name in _encode_fields(spec):
            reads.setdefault(name, "encode")
        color = spec.get("color")
        built = _built(encode, Encodings, f"{function} encode")
    if labels is not None and labels is not False:
        if labels_of is None:
            raise ChartError(
                f"{function} labels: its marks take no labels; drop labels", path="labels"
            )
        if labels is not True or labels_of is not BarLabels:
            # Located as the chart's methods locate them (Chart._series_labels).
            keys = ("at", "edge", "content") if labels_of is SeriesLabels else ("content",)
            problem = label_dict_problem(labels, keys)
            if problem:
                where = f"labels.{problem[0]}"
                raise ChartError(f"{function} {where}: {problem[1]}", path=where)
            try:
                labels = _built(labels, labels_of, f"{function} labels")
            except (ValueError, TypeError) as error:
                raise ChartError(str(error), code="invalid-option", path="labels") from None
            if isinstance(labels, SeriesLabels) and labels.edge is not None and not edges:
                raise ChartError(
                    f"{function} labels.edge: its labels follow its line; drop edge",
                    path="labels.edge",
                )
            for name in _label_fields(labels._spec()):
                reads.setdefault(name, "labels")
    return MarkOptions(function, z_index, built, labels or None, reads, color, item_key)


def _encode_fields(spec: Mapping[str, Any]) -> Iterator[str]:
    """The columns a mark's ``encode`` (as the spec writes it) reads: each
    channel's ``field``, and those a condition's expression reads."""
    for channel in spec.values():
        if isinstance(channel.get("field"), str):
            yield channel["field"]
        condition = channel.get("condition")
        if isinstance(condition, Mapping):
            yield from _expression_fields(condition.get("when"))


def _expression_fields(expression: Any) -> Iterator[str]:
    """The columns an expression (as the spec writes it) reads."""
    if not isinstance(expression, list) or not expression:
        return
    if expression[0] == "field":
        yield expression[1]
        return
    for operand in expression[1:]:
        yield from _expression_fields(operand)


def _label_fields(spec: Mapping[str, Any]) -> Iterator[str]:
    """The columns labels (as the spec writes them) read: a bar label's
    ``field``, and their content's fields."""
    if isinstance(spec.get("field"), str):
        yield spec["field"]
    for part in spec.get("content") or ():
        if isinstance(part, Mapping) and isinstance(part.get("field"), str):
            yield part["field"]


class Outputs:
    """The tables a recipe's marks draw, beside what it computes: names for
    its computed columns, apart from every column of its data, its own
    (`own`: x, y, series, facets, which the options read as it computes
    them), and each other; and the data's columns its mark options read,
    each read once, so the call records it (``hx.recompute`` reads it
    again), to be carried into those tables."""

    def __init__(self, source: Source, options: MarkOptions, own: Collection[str]) -> None:
        self.options = options
        self._taken = {*source.names, *own}
        function = options.function
        for name, option in options.reads.items():
            if name not in own and name not in source.names:
                raise ChartError(
                    f"{function} {option}: no column {name!r} in the data, which has "
                    f"{listed(list(source.names))}; read one of those (x, y, and the series "
                    f"read what {function} draws)",
                    path=option,
                )
        self.columns = {
            name: source.column(name, f"{function} {option}")
            for name, option in options.reads.items()
            if name not in own
        }

    def named(self, *wanted: str) -> list[str]:
        """Names for computed columns, `wanted` where the data has no such
        column (``n``, or ``n_`` beside the data's own ``n``)."""
        return fresh(wanted, self._taken)

    def rows(self, rows: np.ndarray, only: Collection[str] | None = None) -> dict[str, Column]:
        """The carried columns (`only` those, when given) at the data's
        `rows`, for a recipe drawing rows."""
        return {
            name: Column(column.kind, column.values[rows], column.dictionary)
            for name, column in self.columns.items()
            if only is None or name in only
        }

    def per_group(
        self,
        grouping: Grouping,
        names: Sequence[str],
        keys: np.ndarray,
        *,
        drawn: str,
        instead: str,
        only: Collection[str] | None = None,
    ) -> dict[str, Column]:
        """The carried columns (`only` those, when given) at `keys` (each
        drawn row's group: a level index per variable of `grouping`, which
        `names` names), each its one value in the group's rows, missing
        where no group has the key; refused where it varies within a group
        drawn (as one `drawn`), with what to do `instead`."""
        columns = {
            name: column for name, column in self.columns.items() if only is None or name in only
        }
        if not columns:
            return {}
        at, found = _groups_at(grouping, keys)
        used = np.unique(at[found])
        out: dict[str, Column] = {}
        for name, column in columns.items():
            each = column.values[[members[0] for members in grouping.rows]]
            for g in used:
                found_values = column.values[grouping.rows[g]]
                if not _constant(found_values):
                    option = self.options.reads[name]
                    function = self.options.function
                    raise ChartError(
                        f"{function} {option}: column {name!r} varies within the rows of "
                        f"{_group_name(grouping, names, g)}, which {function} draws as one "
                        f"{drawn}; {instead}",
                        code="invalid-option",
                        path=option,
                    )
            missing = np.nan if column.values.dtype.kind == "f" else -1
            picked = np.full(len(at), missing, dtype=column.values.dtype)
            picked[found] = each[at[found]]
            out[name] = Column(column.kind, picked, column.dictionary)
        return out


def carry(table: dict[str, Column], carried: Mapping[str, Column]) -> None:
    """Adds carried columns to a recipe's table, whose computed columns took
    names apart from the data's (``Outputs.named``)."""
    clash = set(table) & set(carried)
    if clash:
        raise RuntimeError(f"express: carried columns {sorted(clash)} would replace computed ones")
    table.update(carried)


def keys_of(variables: Mapping[str, Levels], table: Mapping[str, Column], count: int) -> np.ndarray:
    """Each of a table's `count` rows' key (a level index per variable),
    read back from the category columns ``keyed_table`` wrote."""
    columns = []
    for name, variable in variables.items():
        codes = table[name].values.astype(np.int64)
        # Over a whole dictionary, a level's code is its place in it.
        places = variable.places
        columns.append(codes if places is None else np.searchsorted(places, codes))
    return np.stack(columns, axis=1) if columns else np.zeros((count, 0), dtype=np.int64)


def _groups_at(grouping: Grouping, keys: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each key's group in `grouping`, and whether it has one."""
    keys = np.asarray(keys, dtype=np.int64).reshape(len(keys), grouping.keys.shape[1])
    groups = len(grouping.rows)
    if keys.shape[1] == 0:
        return np.zeros(len(keys), dtype=np.intp), np.full(len(keys), groups > 0)
    if groups == 0:
        return np.zeros(len(keys), dtype=np.intp), np.zeros(len(keys), dtype=bool)
    # Grouping keys are distinct and in order, so their flat indexes are sorted.
    dims = tuple(
        int(max(grouping.keys[:, i].max(), keys[:, i].max(initial=0))) + 1
        for i in range(keys.shape[1])
    )
    flat = np.ravel_multi_index(tuple(grouping.keys.T), dims)
    wanted = np.ravel_multi_index(tuple(keys.T), dims)
    at = np.minimum(np.searchsorted(flat, wanted), groups - 1)
    return at, flat[at] == wanted


def _constant(found: np.ndarray) -> bool:
    if len(found) < 2:
        return True
    if found.dtype.kind == "f":
        return bool(np.array_equal(found, np.full_like(found, found[0]), equal_nan=True))
    return bool((found == found[0]).all())


def _group_name(grouping: Grouping, names: Sequence[str], index: int) -> str:
    """A group as a refusal names it: "day 'Thu' and sex 'Male'"."""
    key = grouping.keys[index]
    parts = [
        f"{name} {variable.labels[int(level)]!r}"
        for name, variable, level in zip(names, grouping.variables, key, strict=True)
    ]
    return " and ".join(parts) if parts else "the plot"
