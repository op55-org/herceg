"""Data preparation in the chart spec: expressions and derived tables.

``hg.col("temp") > 30`` builds a portable expression, and ``hg.derive(df)``
chains transforms (filter, calculate, bin, aggregate, rolling, sort) whose
rows the chart computes in the browser, where they follow streamed updates.
"""

from __future__ import annotations

import datetime as _dt
import functools
import inspect
import math
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from typing import Any, TypedDict, TypeVar

import numpy as np

from ._data import Column, Table, listlike
from ._errors import (
    ChartError,
    ChartErrorCode,
    Role,
    check_hints,
    checks_hints,
    hints_of,
    is_number,
    keys_shown,
    listed,
    located,
    python_values,
    refusing,
    shown,
)

#: Kinds of columns whose values steps can compare and group: all but shapes.
_VALUES = ("number", "time", "category")

AGGREGATES = (
    *("count", "sum", "mean", "median", "min", "max", "q1", "q3"),
    *("stdev", "variance", "distinct", "first", "last"),
)
ROLLING = ("count", "sum", "mean", "min", "max", "stdev")
# Operations whose result is a value of the field: on a time field, a time.
_KEEPS_KIND = {"mean", "median", "min", "max", "q1", "q3", "first", "last"}


def _operand(value: Any, role: str) -> Any:
    """`_literal(value)`, its refusals said at `role` ("filter condition")."""
    try:
        return _literal(value)
    except (TypeError, ValueError) as error:
        code = error.code if isinstance(error, ChartError) else "invalid-option"
        raise ChartError(str(error).replace("expression", role, 1), code=code) from None


def _literal(value: Any) -> Any:
    """The JSON form of an expression operand."""
    if isinstance(value, Expr):
        return value._json
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, np.datetime64):
        return float(value.astype("datetime64[ms]").astype(np.int64))
    if isinstance(value, _dt.datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc)
        return moment.timestamp() * 1000
    if is_number(value) and not isinstance(value, bool):
        number = float(value)
        if not np.isfinite(number):
            raise ChartError(f"expression: expected finite numbers; received {value!r}")
        return int(number) if number.is_integer() and abs(number) < 2**53 else number
    raise ChartError(
        "expression: expected numbers, text, True, False, None, datetimes, or expressions; "
        f"received {type(value).__name__}"
    )


class Expr:
    """A portable expression over a table's columns, built with Python operators.

    Combine conditions with ``&``, ``|``, and ``~`` (``and``/``or``/``not``
    cannot be overloaded), as in pandas.
    """

    __slots__ = ("_json",)

    def __init__(self, json: Any) -> None:
        self._json = json

    def to_json(self) -> Any:
        """The expression as the spec's JSON array."""
        return self._json

    def __repr__(self) -> str:
        return f"Expr({self._json!r})"

    def _op(self, op: str, *others: Any) -> Expr:
        return Expr([op, self._json, *(_literal(other) for other in others)])

    def _rop(self, op: str, other: Any) -> Expr:
        return Expr([op, _literal(other), self._json])

    def __bool__(self) -> bool:
        raise TypeError(
            "expression: is not true or false in Python; combine conditions with &, |, and ~"
        )

    __hash__ = None  # type: ignore[assignment]

    def __eq__(self, other: object) -> Expr:  # type: ignore[override]
        return self._op("==", other)

    def __ne__(self, other: object) -> Expr:  # type: ignore[override]
        return self._op("!=", other)

    def __lt__(self, other: Any) -> Expr:
        return self._op("<", other)

    def __le__(self, other: Any) -> Expr:
        return self._op("<=", other)

    def __gt__(self, other: Any) -> Expr:
        return self._op(">", other)

    def __ge__(self, other: Any) -> Expr:
        return self._op(">=", other)

    def __and__(self, other: Any) -> Expr:
        return self._op("and", other)

    def __rand__(self, other: Any) -> Expr:
        return self._rop("and", other)

    def __or__(self, other: Any) -> Expr:
        return self._op("or", other)

    def __ror__(self, other: Any) -> Expr:
        return self._rop("or", other)

    def __invert__(self) -> Expr:
        return Expr(["not", self._json])

    def __add__(self, other: Any) -> Expr:
        return self._op("+", other)

    def __radd__(self, other: Any) -> Expr:
        return self._rop("+", other)

    def __sub__(self, other: Any) -> Expr:
        return self._op("-", other)

    def __rsub__(self, other: Any) -> Expr:
        return self._rop("-", other)

    def __mul__(self, other: Any) -> Expr:
        return self._op("*", other)

    def __rmul__(self, other: Any) -> Expr:
        return self._rop("*", other)

    def __truediv__(self, other: Any) -> Expr:
        return self._op("/", other)

    def __rtruediv__(self, other: Any) -> Expr:
        return self._rop("/", other)

    def __mod__(self, other: Any) -> Expr:
        return self._op("%", other)

    def __pow__(self, other: Any) -> Expr:
        return self._op("pow", other)

    def __neg__(self) -> Expr:
        return Expr(["-", self._json])

    def __abs__(self) -> Expr:
        return Expr(["abs", self._json])

    def sqrt(self) -> Expr:
        return Expr(["sqrt", self._json])

    def exp(self) -> Expr:
        return Expr(["exp", self._json])

    def log(self) -> Expr:
        return Expr(["log", self._json])

    def log10(self) -> Expr:
        return Expr(["log10", self._json])

    def round(self) -> Expr:
        return Expr(["round", self._json])

    def floor(self) -> Expr:
        return Expr(["floor", self._json])

    def ceil(self) -> Expr:
        return Expr(["ceil", self._json])

    def is_in(self, *values: Any) -> Expr:
        """True where the value is one of ``values``."""
        given = [
            located(f"values[{i}]", functools.partial(_literal, value))
            for i, value in enumerate(values)
        ]
        return Expr(["in", self._json, *given])

    def is_missing(self) -> Expr:
        """True where the value is missing (NaN, or a missing category)."""
        return Expr(["missing", self._json])


def col(name: str) -> Expr:
    """A column of the table an expression is evaluated against."""
    if not isinstance(name, str):
        raise ChartError(f"col name: expected a column's name; received {shown(name)}", path="name")
    return Expr(["field", name])


def when(condition: Expr, then: Any, otherwise: Any) -> Expr:
    """``then`` where ``condition`` holds, else ``otherwise``."""
    if not isinstance(condition, Expr):
        raise ChartError(
            "when condition: expected an expression that holds or not, such as "
            f'hg.col("v") > 1; received {shown(condition)}',
            path="condition",
        )
    branches = [
        located(name, functools.partial(_literal, value))
        for name, value in (("then", then), ("otherwise", otherwise))
    ]
    return Expr(["if", _literal(condition), *branches])


class _Kinds:
    """Column names in order, each kind looked up only when first asked for, so
    columns no step or mark reads are never converted."""

    def __init__(
        self,
        names: Sequence[str],
        known: dict[str, str],
        lookup: Callable[[str], str] | None = None,
    ) -> None:
        self._names = list(dict.fromkeys(names))
        self._set = set(self._names)
        self._known = dict(known)
        self._lookup = lookup

    def __contains__(self, name: object) -> bool:
        return name in self._set

    def __iter__(self) -> Iterator[str]:
        return iter(self._names)

    def __getitem__(self, name: str) -> str:
        if name not in self._known:
            if self._lookup is None or name not in self._set:
                raise KeyError(name)
            self._known[name] = self._lookup(name)
        return self._known[name]

    def adding(self, kinds: dict[str, str]) -> _Kinds:
        """These columns with others added or replaced."""
        return _Kinds([*self._names, *kinds], {**self._known, **kinds}, self.__getitem__)


_COMPARE = {"==", "!=", "<", "<=", ">", ">="}
_ARITHMETIC = {"+", "-", "*", "/", "%", "pow"}
_MATH = {"abs", "sqrt", "exp", "log", "log10", "round", "floor", "ceil"}


def _type(json: Any, kinds: _Kinds) -> str:
    """What an expression evaluates to ("number", "string", "boolean", or
    "missing" for null), checked as the chart's compiler checks it."""
    if json is None:
        return "missing"
    if isinstance(json, bool):
        return "boolean"
    if isinstance(json, (int, float)):
        return "number"
    if isinstance(json, str):
        return "string"
    op, *args = json

    def typed(arg: Any, expected: str) -> None:
        found = _type(arg, kinds)
        if found != expected and not (found == "missing" and expected == "number"):
            raise TypeError(f"expected {expected} operands for {shown(op)}; received {found}")

    def arity(count: int) -> None:
        if len(args) != count:
            raise TypeError(
                f"expected {count} operand{'s' * (count != 1)} for {shown(op)}; "
                f"received {len(args)}"
            )

    if op == "field":
        name = args[0]
        if name not in kinds:
            raise KeyError(f"no column {name!r}; the rows have {', '.join(map(repr, kinds))}")
        if kinds[name] == "geometry":
            raise TypeError(f"column {name!r} holds shapes, which expressions cannot read")
        return "string" if kinds[name] == "category" else "number"
    if op in _COMPARE:
        arity(2)
        a, b = (_type(arg, kinds) for arg in args)
        if "missing" in (a, b):
            if op not in ("==", "!="):
                raise TypeError(
                    f"{shown(op)} cannot compare with None; test missing values with is_missing()"
                )
        elif a != b:
            raise TypeError(f"{shown(op)} compares {a} with {b}; give both sides one type")
        return "boolean"
    if op in ("and", "or", "not"):
        if op == "not":
            arity(1)
        for arg in args:
            typed(arg, "boolean")
        return "boolean"
    if op in _ARITHMETIC or op in _MATH or op in ("min", "max"):
        if op in _ARITHMETIC and not (op == "-" and len(args) == 1):
            arity(2)
        if op in _MATH:
            arity(1)
        for arg in args:
            typed(arg, "number")
        return "number"
    if op == "in":
        if len(args) < 2:
            raise TypeError('"in" needs a value and at least one candidate; give is_in() one')
        value = _type(args[0], kinds)
        for candidate in args[1:]:
            if isinstance(candidate, list) or (
                candidate is not None and _type(candidate, kinds) != value
            ):
                raise TypeError(
                    f'expected {value} literals as "in" candidates; received {shown(candidate)}'
                )
        return "boolean"
    if op == "missing":
        arity(1)
        _type(args[0], kinds)
        return "boolean"
    if op == "if":
        arity(3)
        typed(args[0], "boolean")
        then, otherwise = (_type(arg, kinds) for arg in args[1:])
        if "missing" not in (then, otherwise) and then != otherwise:
            raise TypeError(f'"if" branches give {then} and {otherwise}; give both one type')
        kind = then if then != "missing" else otherwise
        return "number" if kind == "missing" else kind
    raise TypeError(f"unknown expression operator {shown(op)}")


def _fields_of(json: Any) -> set[str]:
    """The columns an expression reads."""
    if isinstance(json, list):
        if json and json[0] == "field":
            return {json[1]}
        return set().union(*(_fields_of(item) for item in json[1:]))
    return set()


def _value_kind(json: Any, kinds: _Kinds) -> str:
    """The kind of column an expression's values make: text makes categories, and
    anything else numbers, as in the chart (a copy of a time column too)."""
    return "category" if _type(json, kinds) == "string" else "number"


#: A bin definition as functions take it: a count, a step/start dict, or edges.
class _Step(TypedDict):
    step: float


class BinStep(_Step, total=False):
    """Bins ``step`` wide, from ``start`` (a round number by default)."""

    start: float | None


BinSpec = int | BinStep | Sequence[float] | np.ndarray[Any, Any]


def _finite(value: Any) -> bool:
    """Whether a value is a finite real number (NumPy's included), not a bool."""
    if not is_number(value) or isinstance(value, (bool, np.bool_)):
        return False
    try:
        return math.isfinite(float(value))
    except (OverflowError, ValueError):
        return False


def bin_spec(bins: Any, role: str) -> int | dict[str, float] | list[float]:
    """Bins along one axis as the spec takes them, as histograms and the bin
    transform do: about how many round bins (a whole number), a
    ``{"step", "start"}`` dict, or 2 to 1,001 finite, increasing edges. ``role``
    names them in errors."""
    if isinstance(bins, Mapping):
        unknown = set(bins) - {"step", "start"}
        if unknown:
            given = keys_shown(unknown)
            raise ChartError(f"{role}: a step/start dict takes step and start; received {given}")
        step = bins.get("step")
        if step is None or not _finite(step) or step <= 0:
            raise ChartError(f"{role} step: expected a positive number; received {shown(step)}")
        start = bins.get("start")
        if start is not None and not _finite(start):
            raise ChartError(f"{role} start: expected a finite number; received {shown(start)}")
        return {"step": float(step), **({"start": float(start)} if start is not None else {})}
    if is_number(bins) and not isinstance(bins, (bool, np.bool_)):
        if not _finite(bins) or float(bins) < 1 or not float(bins).is_integer():
            raise ChartError(
                f"{role}: expected a whole number of at least 1; received {shown(bins)}"
            )
        return int(float(bins))
    if isinstance(bins, np.ndarray) and bins.ndim != 1:
        raise ChartError(f"{role}: expected a 1-D array of edges; received shape {bins.shape}")
    if not (listlike(bins) or isinstance(bins, np.ndarray)):
        raise ChartError(
            f"{role}: expected a whole number, a step/start dict, or a sequence of edges; "
            f"received {shown(bins)}"
        )
    if len(bins) < 2 or len(bins) > 1001:
        raise ChartError(f"{role}: expected 2 to 1001 edges; received {len(bins)}")
    edges: list[float] = []
    for i, edge in enumerate(bins):
        if not _finite(edge):
            raise ChartError(f"{role}[{i}]: expected a finite number; received {shown(edge)}")
        value = float(edge)
        if edges and not value > edges[-1]:
            raise ChartError(
                f"{role}[{i}]: expected an edge above the one before; "
                f"received {value:g} after {edges[-1]:g}"
            )
        edges.append(value)
    return edges


_M = TypeVar("_M", bound=Callable[..., Any])


def _made(name: Any, role: str) -> None:
    """Refuses a name for a column a step makes unless it is text."""
    if not isinstance(name, str) or not name:
        raise ChartError(f"{role}: expected a column's name; received {shown(name)}")


def _step(method: _M) -> _M:
    """Makes a transform's refusals (``bin: column 'site' holds categories``)
    ChartErrors, at the option they name; a column the rows lack is an
    unknown field."""
    name = method.__name__
    signature = inspect.signature(method)

    @functools.wraps(method)
    def step(self: Derived, *args: Any, **kwargs: Any) -> Derived:
        bound = signature.bind_partial(self, *args, **kwargs)
        # Operations are named by keyword (aggregate's and rolling's).
        with refusing((name,), {*signature.parameters, *kwargs}):
            given, hints = dict(bound.arguments), hints_of(method)
            changed, later = python_values(name, given, hints)
            bound.arguments.update(changed)
            derived = method(*bound.args, **bound.kwargs)
            # Last, for what the step's own checks let through: theirs say more.
            check_hints(name, given, later)
            return derived

    return step  # type: ignore[return-value]


class Derived:
    """Rows computed from a data source by transforms, in the chart's browser.

    Build one with ``hg.derive(data)`` and pass it as a chart's or mark's
    data. Every step checks the columns it reads against those before it.
    ``source`` and ``steps`` are its lineage: the data it is computed from
    and its transform steps in order, as the spec writes them.
    """

    def __init__(
        self,
        source: Any,
        steps: Sequence[dict[str, Any]],
        kinds: _Kinds,
        table: Table | _InOrder | None = None,
    ) -> None:
        self.source = source
        self.steps: tuple[dict[str, Any], ...] = tuple(steps)
        self._kinds = kinds
        # The source's converted columns, shared with charts of this table.
        self._table = table

    @property
    def columns(self) -> dict[str, str]:
        """The derived table's columns and their kinds."""
        return {name: self._kinds[name] for name in self._kinds}

    def _then(self, step: dict[str, Any], kinds: _Kinds) -> Derived:
        return Derived(self.source, [*self.steps, step], kinds, self._table)

    def _require(
        self,
        names: Any,
        role: str,
        kinds: tuple[str, ...] | None = None,
        *,
        at: str,
        one: bool = False,
        given: bool = False,
    ) -> None:
        """Refuses at the argument `at` columns the rows do not have, or of
        other `kinds`; with `one`, anything but a column's name; a list the
        caller `given`, at each name's index."""
        if not isinstance(names, str) and (one or not listlike(names)):
            raise ChartError(f"{role}: expected a column name; received {shown(names)}", path=at)
        for i, name in enumerate([names] if isinstance(names, str) else names):
            # Names the caller listed are refused at their index.
            listed_at = given and not isinstance(names, str)
            where, path = (f"{role}[{i}]", f"{at}[{i}]") if listed_at else (role, at)
            if not isinstance(name, str):
                raise ChartError(
                    f"{where}: expected column names; received {shown(name)}", path=path
                )
            if name not in self._kinds:
                available = ", ".join(repr(known) for known in self._kinds)
                raise ChartError(
                    f"{where}: no column {name!r}; the rows have {available}",
                    code="unknown-field",
                    path=path,
                )
            if kinds is not None and self._kinds[name] not in kinds:
                raise ChartError(
                    f"{where}: column {name!r} holds {self._kinds[name]} values; "
                    f"expected {' or '.join(kinds)}",
                    code="field-type",
                    path=path,
                )

    @_step
    def filter(self, condition: Expr) -> Derived:
        """Keeps rows where ``condition`` is true."""
        json = _operand(condition, "filter condition")
        self._require(sorted(_fields_of(json)), "filter", at="condition")
        kind = _checked(json, self._kinds, "filter condition")
        if kind != "boolean":
            raise ChartError(
                f"filter condition: expected a true or false condition; received a {kind} "
                "expression"
            )
        return self._then({"filter": json}, self._kinds)

    @_step
    def calculate(self, name: str, value: Any) -> Derived:
        """Adds (or replaces) the column ``name`` with the value of an expression."""
        _made(name, "calculate name")
        json = _operand(value, "calculate value")
        self._require(sorted(_fields_of(json)), "calculate", at="value")
        _checked(json, self._kinds, "calculate value")
        kind = _value_kind(json, self._kinds)
        return self._then({"calculate": json, "as": name}, self._kinds.adding({name: kind}))

    @_step
    def bin(
        self,
        column: str,
        *,
        bins: BinSpec | None = None,
        name: str | None = None,
        end: str | None = None,
    ) -> Derived:
        """Replaces a number or time column (or adds ``name``) with the start of
        its bin, and with ``end`` adds a column of the bin's end. ``bins`` takes
        bins as ``Chart.histogram`` does: about how many round bins (10 by
        default), ``{"step": ..., "start": ...}``, or edges. Values in no bin
        (missing, below a start, or outside the edges) have none."""
        self._require(column, "bin", ("number", "time"), at="column", one=True)
        for given, option in ((name, "name"), (end, "end")):
            if given is not None:
                _made(given, f"bin {option}")
        spec_bins = None if bins is None else bin_spec(bins, "bin bins")
        if end is not None and end == (name or column):
            raise ChartError(
                f"bin end: {end!r} also names the bins' starts; give the ends another name"
            )
        spec = {"bin": column, "bins": spec_bins, "as": name, "end": end}
        kind = self._kinds[column]
        kinds = self._kinds.adding({name or column: kind, **({end: kind} if end else {})})
        return self._then({k: v for k, v in spec.items() if v is not None}, kinds)

    @_step
    def aggregate(self, by: str | Sequence[str] | None = None, **operations: Any) -> Derived:
        """One row per group of ``by`` columns, with each named operation, as in
        pandas' named aggregation: ``n="count"`` or ``mean=("temp", "mean")``."""
        self._require([] if by is None else by, "aggregate by", _VALUES, at="by", given=True)
        keys = [by] if isinstance(by, str) else [] if by is None else list(by)
        if not operations:
            raise ChartError('aggregate: needs at least one operation, such as n="count"')
        specs = []
        kinds = {name: self._kinds[name] for name in keys}
        for name, operation in operations.items():
            # Each operation is at the keyword naming its output.
            at = Role("aggregate").key(name)
            if not isinstance(operation, str) and not (listlike(operation) and len(operation) == 2):
                raise at.error(
                    'expected an operation, such as "count", or a (column, '
                    f"operation) pair; received {shown(operation)}"
                )
            column, op = (None, operation) if isinstance(operation, str) else tuple(operation)
            if not isinstance(op, str) or op not in AGGREGATES:
                raise at.error(f"unknown operation {shown(op)}; name one of {listed(AGGREGATES)}")
            if column is None and op != "count":
                raise at.error(f'{shown(op)} needs a column; give ("column", {shown(op)})')
            if column is not None:
                self._require(column, at.label, ("number", "time"), at=str(at.path), one=True)
            specs.append(
                {"op": op, **({"field": column} if column is not None else {}), "as": name}
            )
            keeps = column is not None and op in _KEEPS_KIND and self._kinds[column] == "time"
            kinds[name] = "time" if keeps else "number"
        step = {"aggregate": specs, **({"by": keys} if keys else {})}
        return self._then(step, _Kinds(list(kinds), kinds))

    @_step
    def rolling(
        self, size: int, *, by: str | Sequence[str] | None = None, **operations: Any
    ) -> Derived:
        """Adds each named operation over the trailing ``size`` rows, within each
        group of ``by`` columns: ``avg=("temp", "mean")``."""
        if not (isinstance(size, int) and not isinstance(size, bool) and size >= 1):
            raise ChartError(
                f"rolling size: expected a whole number of at least 1; received {shown(size)}"
            )
        self._require([] if by is None else by, "rolling by", _VALUES, at="by", given=True)
        keys = [by] if isinstance(by, str) else [] if by is None else list(by)
        if not operations:
            raise ChartError('rolling: needs at least one operation, such as avg=("temp", "mean")')
        specs = []
        kinds: dict[str, str] = {}
        for name, operation in operations.items():
            # Each operation is at the keyword naming its output.
            at = Role("rolling").key(name)
            if isinstance(operation, str) or not (listlike(operation) and len(operation) == 2):
                raise at.error(
                    'expected a (column, operation) pair, such as ("temp", '
                    f'"mean"); received {shown(operation)}'
                )
            column, op = tuple(operation)
            if not isinstance(op, str) or op not in ROLLING:
                raise at.error(f"unknown operation {shown(op)}; name one of {listed(ROLLING)}")
            self._require(column, at.label, ("number", "time"), at=str(at.path), one=True)
            specs.append({"op": op, "field": column, "as": name})
            keeps = op in _KEEPS_KIND and self._kinds[column] == "time"
            kinds[name] = "time" if keeps else "number"
        step = {"rolling": specs, "size": size, **({"by": keys} if keys else {})}
        return self._then(step, self._kinds.adding(kinds))

    @_step
    def sort(self, column: str, *, descending: bool = False) -> Derived:
        """Orders rows by a column, stably, missing values last."""
        self._require(column, "sort", _VALUES, at="column", one=True)
        if not isinstance(descending, bool):
            raise ChartError(
                f"sort descending: expected True or False; received {shown(descending)}"
            )
        return self._then(
            {"sort": column, "order": "descending" if descending else "ascending"}, self._kinds
        )

    def source_columns(self, used: Iterable[str] = ()) -> set[str]:
        """Columns of the source the steps read, and those of ``used`` (columns read
        from the derived rows) that come from the source unchanged. A column read
        after a step made or replaced it is not the source's."""
        used = _names_used(used)
        needs: set[str] = set()
        made: set[str] = set()
        for step in self.steps:
            needs |= _reads(step) - made
            made |= _writes(step)
        return needs | ({name for name in used if name in self._kinds} - made)


def _names_used(used: Any) -> list[str]:
    """``source_columns``'s ``used``, checked: column names."""
    if (
        isinstance(used, (str, bytes, Mapping))
        or not isinstance(used, Iterable)
        or (isinstance(used, np.ndarray) and used.ndim != 1)
    ):
        raise ChartError(
            f"source_columns used: expected column names; received {shown(used)}",
            path="used",
        )
    used = list(used)
    for i, name in enumerate(used):
        if not isinstance(name, str):
            raise ChartError(
                f"source_columns used[{i}]: expected a column's name; received {shown(name)}",
                path=f"used[{i}]",
            )
    return used


def _reads(step: dict[str, Any]) -> set[str]:
    """The columns a step reads."""
    reads: set[str] = set()
    for key in ("filter", "calculate"):
        if key in step:
            reads |= _fields_of(step[key])
    for key in ("bin", "sort"):
        if key in step:
            reads.add(step[key])
    reads |= set(step.get("by", []))
    for operation in step.get("aggregate", []) + step.get("rolling", []):
        if "field" in operation:
            reads.add(operation["field"])
    return reads


def _writes(step: dict[str, Any]) -> set[str]:
    """The columns a step makes or replaces: an aggregate makes every column of its rows."""
    if "calculate" in step:
        return {step["as"]}
    if "bin" in step:
        return {step.get("as", step["bin"]), *([step["end"]] if "end" in step else [])}
    if "aggregate" in step:
        return {*step.get("by", []), *(operation["as"] for operation in step["aggregate"])}
    return {operation["as"] for operation in step.get("rolling", [])}


def _checked(json: Any, kinds: _Kinds, role: str) -> str:
    """An expression's type, with errors naming the step."""
    try:
        return _type(json, kinds)
    except (KeyError, TypeError) as error:
        message = error.args[0] if error.args else str(error)
        code: ChartErrorCode = "unknown-field" if isinstance(error, KeyError) else "invalid-option"
        raise ChartError(f"{role}: {message}", code=code) from None


def derive(data: Any) -> Derived:
    """Starts transforms of a data source (or of another derived table)."""
    if isinstance(data, Derived):
        return Derived(data, [], data._kinds)
    if isinstance(data, View):
        raise ChartError(
            "derive data: a view; derive from its data, with its filter as a step", path="data"
        )
    table = data.table if isinstance(data, Ordered) else located("data", lambda: Table(data))
    return Derived(data, [], _Kinds(table.names, {}, lambda name: table.column(name).kind), table)


class View:
    """The rows of a data source that ``filter`` keeps, in the order ``sort``
    gives (the data's own without), which series marks (lines, areas, bars,
    points, heatmaps, rugs, error bars, candlesticks, histograms, box plots,
    boxen, and violins) draw as they would a table of those rows.

    Build one with ``hg.view(data, filter=..., sort=...)`` and pass it as a
    mark's data. The chart sends the data's columns once and the view as a
    question about them, answered in the browser as rows change: views of
    one table cost no copies. Colors, legends, and row selections stay the
    data's; a row selection binds the data itself.
    """

    def __init__(
        self, source: Any, query: dict[str, Any], kinds: _Kinds, table: Table | _InOrder | None
    ) -> None:
        self.source = source
        #: The view as the spec writes it: ``{"filter": ..., "sort": [...]}``.
        self.query = query
        self._kinds = kinds
        self._table = table

    @property
    def columns(self) -> dict[str, str]:
        """The view's columns, the data's, and their kinds."""
        return {name: self._kinds[name] for name in self._kinds}

    def source_columns(self, used: Iterable[str] = ()) -> set[str]:
        """Columns of the data the filter and sort read, with those of ``used``."""
        reads = _fields_of(self.query["filter"]) if "filter" in self.query else set()
        reads |= {key["field"] for key in self.query.get("sort", [])}
        return reads | {name for name in _names_used(used) if name in self._kinds}


@checks_hints("view")
def view(
    data: Any,
    *,
    filter: Expr | None = None,
    sort: str | Sequence[str] | None = None,
    descending: bool | Sequence[bool] = False,
) -> View:
    """The rows of ``data`` (a data source or a derived table) where
    ``filter`` holds, ordered by the ``sort`` columns (each ``descending``
    or not), for series marks to draw: ``hg.view(flights, filter=hg.col(
    "delay") >= -20)``."""
    if isinstance(data, View):
        raise ChartError(
            "view data: already a view; give its data, and join the filters with &", path="data"
        )
    checked = derive(data)
    query: dict[str, Any] = {}
    if filter is not None:
        if not isinstance(filter, Expr):
            raise ChartError(
                "view filter: expected an expression, such as hg.col(...) > 1; "
                f"received {shown(filter)}",
                path="filter",
            )
        checked = located("filter", lambda: checked.filter(filter))
        query["filter"] = checked.steps[-1]["filter"]
    keys = [] if sort is None else [sort] if isinstance(sort, str) else sort
    if not listlike(keys) or not all(isinstance(key, str) for key in keys):
        raise ChartError(
            f"view sort: expected a column's name or a list of them; received {shown(sort)}",
            path="sort",
        )
    if not isinstance(descending, bool) and not listlike(descending):
        raise ChartError(
            "view descending: expected True or False, or one for each sort column; "
            f"received {shown(descending)}",
            path="descending",
        )
    downs = [descending] * len(keys) if isinstance(descending, bool) else list(descending)
    if len(downs) != len(keys):
        raise ChartError(
            f"view descending: one for each of the {len(keys)} sort columns; received {len(downs)}",
            path="descending",
        )
    order = []
    for key, down in zip(keys, downs, strict=True):
        located("sort", functools.partial(checked.sort, key, descending=down))
        order.append({"field": key, "order": "descending" if down else "ascending"})
    if order:
        query["sort"] = order
    return View(data, query, checked._kinds, checked._table)


class Ordered:
    """Rows kept in ascending order of a number or time column, ties in the
    order they came: ``hg.ordered(df, by="time", max_rows=180_000)``.

    Pass it as a chart's or mark's data. Live charts (``widget.append``)
    merge rows that arrive late into place, in the browser and in Python's
    copy alike, and keep the last ``max_rows`` in order, so a late row
    earlier than every row kept is not kept. Rows keep their identity as
    others move in front of them: selections stay on their observations.
    Positions (``RowSelection.rows``, ``selection=``) count rows in order,
    as ``df.sort_values(by, kind="stable")`` has them.
    """

    def __init__(self, data: Any, by: str, max_rows: int | None) -> None:
        if isinstance(data, (Derived, View, Ordered)):
            raise ChartError(
                "ordered data: give a data source; its rows are put in order as given",
                path="data",
            )
        if max_rows is not None and (
            not isinstance(max_rows, int) or isinstance(max_rows, bool) or max_rows < 1
        ):
            raise ChartError(
                "ordered max_rows: expected a whole number of at least 1; "
                f"received {shown(max_rows)}",
                path="max_rows",
            )
        given = located("data", lambda: Table(data))
        if not isinstance(by, str) or by not in given.names:
            available = ", ".join(repr(name) for name in given.names)
            raise ChartError(
                f"ordered by: no column {by!r}; the data has {available}",
                code="unknown-field",
                path="by",
            )
        column = located("by", lambda: given.column(by))
        if column.kind not in ("number", "time"):
            raise ChartError(
                f"ordered by: column {by!r} holds {column.kind} values; "
                "give a number or time column",
                code="field-type",
                path="by",
            )
        missing = np.flatnonzero(np.isnan(column.values))
        if missing.size:
            raise ChartError(
                f"ordered by: row {int(missing[0])} is missing; an ordered table needs every "
                f"row's {by}",
                path="by",
            )
        self.data = data
        self.by = by
        self.max_rows = max_rows
        order = np.argsort(column.values, kind="stable")
        #: Each row kept, in order, by its position in the data given: what numbers it.
        self.order = order if max_rows is None else order[-max_rows:]
        #: How many rows the data given has.
        self.given = len(column)
        #: The rows in order, as charts read them.
        self.table = _InOrder(given, self.order)


class _InOrder:
    """A table's columns with their rows taken in ``order``, each column
    converted and taken only when first read, as tables read them."""

    def __init__(self, table: Table, order: np.ndarray) -> None:
        self.names = table.names
        self._source = table
        self._order = order
        self._columns: dict[str, Column] = {}

    def column(self, name: str) -> Column:
        """The converted column in order; KeyError for unknown names."""
        column = self._columns.get(name)
        if column is None:
            given = self._source.column(name)
            column = Column(given.kind, given.values[self._order], given.dictionary, given.shapes)
            self._columns[name] = column
        return column


@checks_hints("ordered")
def ordered(data: Any, *, by: str, max_rows: int | None = None) -> Ordered:
    """``data``'s rows in ascending order of ``by``, a number or time column
    (ties in the order given), keeping the last ``max_rows`` in order: data
    whose late rows live charts merge into place."""
    return Ordered(data, by, max_rows)
