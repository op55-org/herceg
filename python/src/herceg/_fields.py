"""Field display: how a column is named and its values are written, given
once (``fields``) and read by every surface that writes the column.

``hg.FieldDisplay`` is a column's display, or with ``match`` a rule
applying to every column it matches; ``hg.Match`` matches columns by name,
regular expression, kind, and table; ``hg.Mapping`` shows values as given
text. Charts do not take ``fields`` yet; the spec checks them."""

from __future__ import annotations

import datetime as _dt
import math
from collections.abc import Mapping as MappingABC
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np

from ._data import _time_ms
from ._errors import ChartError, is_number, key_path, listed, placed, refuses, shown
from ._guides import _NUMBER_FORMAT, _TIME_FORMAT, FORMS, Format, _check_format, format_spec
from ._style import _built

#: Kinds of columns displays write.
Kind = Literal["number", "time", "category"]
_KINDS = ("number", "time", "category")


def _value(value: Any, role: str) -> float | str:
    """A mapping's value or end: text, a finite number, or a time as epoch milliseconds."""
    if isinstance(value, str):
        return value
    if isinstance(value, (_dt.datetime, np.datetime64)):
        ms = _time_ms(value)
        if not math.isfinite(ms):
            raise ChartError(f"{role}: a missing time matches nothing; give missing= its text")
        return ms
    if is_number(value) and not isinstance(value, bool) and math.isfinite(value):
        return float(value) if not float(value).is_integer() else int(value)
    raise ChartError(
        f"{role}: expected text, a finite number, or a datetime; received {shown(value)}"
    )


@refuses
@dataclass
class Mapping:
    """Values shown as ``text``: one value (``value``: text for a category
    column, a number, or a datetime for a time column), a range of numbers
    or times (``between=(from, to)``, both ends included, None for an open
    end), or category values matching a regular expression (``regex``,
    JavaScript's syntax; ``$1``, ``$2`` in ``text`` write its groups). Give
    one of the three. The first mapping that matches a value applies."""

    value: str | float | _dt.datetime | None = None
    between: tuple[float | _dt.datetime | None, float | _dt.datetime | None] | None = None
    regex: str | None = None
    text: str | None = None

    def __post_init__(self) -> None:
        given = [name for name in ("value", "between", "regex") if getattr(self, name) is not None]
        if len(given) != 1:
            raise ChartError("Mapping: give value, between, or regex, one of them")
        if not isinstance(self.text, str):
            raise ChartError(f"Mapping text: expected text; received {shown(self.text)}")
        if self.value is not None:
            _value(self.value, "Mapping value")
        if self.regex is not None and not isinstance(self.regex, str):
            raise ChartError(f"Mapping regex: expected text; received {shown(self.regex)}")
        if self.between is not None:
            ends = self.between
            if isinstance(ends, (str, bytes)) or not isinstance(ends, Sequence) or len(ends) != 2:
                raise ChartError(
                    "Mapping between: expected (from, to), None for an open end; "
                    f"received {shown(ends)}"
                )
            low, high = (None if end is None else _value(end, "Mapping between") for end in ends)
            if isinstance(low, str) or isinstance(high, str):
                raise ChartError(
                    f"Mapping between: expected numbers or datetimes; received {shown(ends)}"
                )
            if low is not None and high is not None and low > high:
                raise ChartError(f"Mapping between: {low} is above {high}; give from, then to")

    def _spec(self) -> dict[str, Any]:
        if self.between is not None:
            way: dict[str, Any] = {
                "between": [None if end is None else _value(end, "between") for end in self.between]
            }
        elif self.regex is not None:
            way = {"regex": self.regex}
        else:
            way = {"value": _value(self.value, "value")}
        return {**way, "text": self.text}


@refuses
@dataclass
class Match:
    """Which columns a rule applies to: every column all the given keys hold
    for: named (``field``, a name or several), whose name matches ``regex``
    (a JavaScript regular expression, unanchored: ``"^bytes_"``), of a
    ``kind`` (``"number"``, ``"time"``, ``"category"``, or several), or of
    the spec's table ``table`` names, and the same columns of tables derived
    from it that pass them through unchanged."""

    field: str | Sequence[str] | None = None
    regex: str | None = None
    kind: Kind | Sequence[Kind] | None = None
    table: str | None = None

    def __post_init__(self) -> None:
        if all(getattr(self, name) is None for name in ("field", "regex", "kind", "table")):
            raise ChartError("Match: matches every column; give field, regex, kind, or table")
        names = [self.field] if isinstance(self.field, str) else self.field
        if names is not None and (
            not isinstance(names, Sequence)
            or not names
            or not all(isinstance(n, str) for n in names)
        ):
            raise ChartError(
                f"Match field: expected a column name or names; received {shown(self.field)}"
            )
        for name in ("regex", "table"):
            value = getattr(self, name)
            if value is not None and not isinstance(value, str):
                raise ChartError(f"Match {name}: expected text; received {shown(value)}")
        kinds = [self.kind] if isinstance(self.kind, str) else self.kind
        if kinds is not None and (
            not isinstance(kinds, Sequence) or not kinds or any(k not in _KINDS for k in kinds)
        ):
            raise ChartError(
                f"Match kind: expected {listed(_KINDS)}, or a list of them; "
                f"received {shown(self.kind)}"
            )

    @property
    def _kinds(self) -> list[str] | None:
        if self.kind is None:
            return None
        return [self.kind] if isinstance(self.kind, str) else list(self.kind)

    def _spec(self) -> dict[str, Any]:
        spec = {
            "field": self.field if isinstance(self.field, (str, type(None))) else list(self.field),
            "regex": self.regex,
            "kind": self.kind if isinstance(self.kind, (str, type(None))) else list(self.kind),
            "table": self.table,
        }
        return {key: value for key, value in spec.items() if value is not None}


#: A setting a rule gives, or False, which resets it to the default.
Reset = Literal[False]


def writes(written: dict[str, Any], kind: str) -> bool:
    """Whether a format, as the spec takes it, writes ``kind``: a form its
    own kind; Intl options either kind whose formatter takes every option."""
    form = next((key for key in FORMS if key in written), None)
    if form is not None:
        return (form == "time") == (kind == "time")
    return set(written) <= (_TIME_FORMAT if kind == "time" else _NUMBER_FORMAT)


def _given(value: Any) -> bool:
    """Whether a setting is given: neither left out (None) nor reset (False)."""
    return value is not None and value is not False


@refuses
@dataclass
class FieldDisplay:
    """How a column is named and its values written: ``label`` (its name
    where surfaces name it), ``description``, ``format`` (an ``hg.Format``
    or Intl options: number forms for numbers, time forms for times),
    ``min`` and ``max`` (a number column's bounds, never an axis' domain),
    ``missing`` (the text of missing values), and ``mappings`` (a list of
    ``hg.Mapping``). Each setting also takes False, which resets it.

    As a rule in a list, ``match`` says which columns it applies to: a
    column's name or an ``hg.Match``; without it, every column. Rules apply
    in order, a later rule's settings over an earlier one's, setting by
    setting::

        fields = [
            hg.FieldDisplay(match=hg.Match(kind="number"), format=hg.Format(number=",.1f")),
            hg.FieldDisplay(match="latency", format=hg.Format(duration="millisecond")),
        ]

    A dict of displays by column name is a rule per column. Charts do not
    take ``fields`` yet; the spec checks them."""

    match: str | Match | dict[str, Any] | None = None
    label: str | Reset | None = None
    description: str | Reset | None = None
    format: Format | dict[str, Any] | Reset | None = None
    min: float | Reset | None = None
    max: float | Reset | None = None
    missing: str | Reset | None = None
    mappings: Sequence[Mapping | dict[str, Any]] | Reset | None = None

    def __post_init__(self) -> None:
        if self.match is not None and not isinstance(self.match, str):
            if not isinstance(self.match, (Match, MappingABC)):
                raise ChartError(
                    "FieldDisplay match: expected a column name or an hg.Match; "
                    f"received {shown(self.match)}"
                )
            self.match = _built(self.match, Match, "FieldDisplay match")
        for name in ("label", "description", "missing"):
            value = getattr(self, name)
            if _given(value) and not isinstance(value, str):
                raise ChartError(
                    f"FieldDisplay {name}: expected text or False; received {shown(value)}"
                )
        for name in ("min", "max"):
            value = getattr(self, name)
            if _given(value) and not (
                is_number(value) and not isinstance(value, bool) and math.isfinite(value)
            ):
                raise ChartError(
                    f"FieldDisplay {name}: expected a finite number or False; "
                    f"received {shown(value)}"
                )
        low, high = self.min, self.max
        if _given(low) and _given(high) and not low < high:  # type: ignore[operator]
            raise ChartError(f"FieldDisplay min: {low} is not below max {high}; give min below max")
        if _given(self.format):
            format_spec(self.format, "FieldDisplay format")
            if isinstance(self.format, MappingABC) and not FORMS & set(self.format):
                _check_format(
                    dict(self.format), "FieldDisplay format", _NUMBER_FORMAT | _TIME_FORMAT
                )
        if _given(self.mappings):
            if isinstance(self.mappings, (str, MappingABC)) or not isinstance(
                self.mappings, Sequence
            ):
                raise ChartError(
                    "FieldDisplay mappings: expected a list of hg.Mapping, or False; "
                    f"received {shown(self.mappings)}"
                )
            self.mappings = [
                _built(mapping, Mapping, f"FieldDisplay mappings[{i}]")
                for i, mapping in enumerate(self.mappings)
            ]
        kinds = (
            self.match._kinds
            if isinstance(self.match, Match) and self.match.field is None
            else None
        )
        if kinds:
            self._check_kinds(kinds)

    def _check_kinds(self, kinds: list[str]) -> None:
        """Refuses, for a rule matching kinds and naming no column, settings
        none of its kinds takes, with the first kind's reason."""
        matches = f"this rule matches kind {' or '.join(shown(kind) for kind in kinds)}"
        for name in ("format", "min", "max", "mappings"):
            misfits = [self._misfit(kind, name) for kind in kinds]
            first = misfits[0]
            if first is not None and all(misfits):
                raise ChartError(f"FieldDisplay {name}{first[0]}: {matches}; {first[1]}")

    def _misfit(self, kind: str, name: str) -> tuple[str, str] | None:
        """Why a column of ``kind`` cannot take setting ``name``: where under
        it, and the correction; None where it takes it."""
        value = getattr(self, name)
        if not _given(value):
            return None
        if name == "format":
            if kind == "category":
                return "", "formats are for numbers and times; drop format"
            if not writes(format_spec(value, "FieldDisplay format"), kind):
                if kind == "time":
                    return "", "give hg.Format(time=...) or Intl date options"
                return "", "give a number format"
        if name in ("min", "max") and kind != "number":
            return "", f"bounds are for numbers; drop {name}"
        if name == "mappings":
            for i, mapping in enumerate(value):
                if mapping.between is not None and kind == "category":
                    return f"[{i}] between", "map them by value or regex"
                if mapping.regex is not None and kind != "category":
                    return f"[{i}] regex", "map them by value or between"
                text = kind == "category"
                if mapping.value is not None and isinstance(mapping.value, str) != text:
                    expected = "text" if text else "a number or a datetime"
                    return f"[{i}] value", f"expected {expected}; received {shown(mapping.value)}"
        return None

    def _spec(self) -> dict[str, Any]:
        format, mappings = self.format, self.mappings
        if isinstance(mappings, Sequence):  # each made an hg.Mapping as given
            mappings = [placed(f"mappings[{i}]", m._spec) for i, m in enumerate(mappings)]  # type: ignore[union-attr]
        spec = {
            "match": self.match._spec() if isinstance(self.match, Match) else self.match,
            "label": self.label,
            "description": self.description,
            "format": format if format is False else format_spec(format, "FieldDisplay format"),
            "min": self.min,
            "max": self.max,
            "missing": self.missing,
            "mappings": mappings,
        }
        return {key: value for key, value in spec.items() if value is not None}


#: Field displays: by column name, or rules in order.
FieldDisplays = (
    MappingABC[str, FieldDisplay | dict[str, Any]] | Sequence[FieldDisplay | dict[str, Any]]
)


def fields_spec(fields: Any, role: str) -> Any:
    """``fields`` as the spec takes it: displays by column name, or rules,
    each an ``hg.FieldDisplay`` or a dict of its keyword arguments."""
    if fields is None:
        return None
    if isinstance(fields, MappingABC):
        spec: dict[str, Any] = {}
        for name, display in fields.items():
            at = key_path(role, str(name))
            built = _built(display, FieldDisplay, at)
            if not isinstance(name, str):
                raise ChartError(f"{role}: expected column names as keys; received {shown(name)}")
            if built.match is not None:
                raise ChartError(
                    f"{at}: a display by column name has no match; give rules as a list"
                )
            spec[name] = placed(at, built._spec)
        return spec
    if isinstance(fields, (str, bytes)) or not isinstance(fields, Sequence):
        raise ChartError(
            f"{role}: expected displays by column name, or a list of hg.FieldDisplay; "
            f"received {shown(fields)}"
        )
    return [
        placed(f"{role}[{i}]", _built(rule, FieldDisplay, f"{role}[{i}]")._spec)
        for i, rule in enumerate(fields)
    ]


__all__ = ["FORMS", "FieldDisplay", "FieldDisplays", "Kind", "Mapping", "Match", "fields_spec"]
