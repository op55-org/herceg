"""What keeps a chart from drawing, as every herceg runtime reports it."""

from __future__ import annotations

import dataclasses
import datetime
import difflib
import functools
import inspect
import itertools
import json
import numbers
import operator
import os
import re
import sys
import types
import typing
from collections.abc import Callable, Collection, Iterator, Mapping, Sequence
from collections.abc import Callable as CallableABC
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from typing import Any, Literal, TypeGuard, TypeVar

import numpy as np

if sys.version_info >= (3, 11):
    from typing import Unpack
else:
    from typing_extensions import Unpack

_T = TypeVar("_T")

#: What kind of problem it is (see ``ChartError``).
ChartErrorCode = Literal[
    "invalid-option",
    "unknown-field",
    "field-type",
    "series-varies",
    "series-with-values",
    "unknown-reference",
    "unsupported",
    "layout-failed",
    "load-failed",
    "render-failed",
]
#: When it happened: checking options, compiling them, loading code, laying
#: the chart out, or drawing a frame of its data.
ChartErrorPhase = Literal["validate", "compile", "load", "layout", "render"]


class ChartError(ValueError):
    """Options or data a chart refuses: herceg's errors, in one shape in Python,
    TypeScript, and the browser, raised where a mark is added, a chart is
    output, or the JavaScript engine draws it.

    ``code`` says what kind of problem it is: ``"invalid-option"``,
    ``"unknown-field"`` (a column the data does not have), ``"field-type"``
    (a column whose values an option cannot take), ``"series-varies"`` (a
    line's or area's color changing within one of its series),
    ``"series-with-values"`` (several value columns and a series column),
    ``"unknown-reference"`` (a panel or scale the chart does not have),
    ``"unsupported"`` (a well-formed option the chart cannot draw, with what
    to do instead), ``"layout-failed"``, ``"load-failed"`` (code or data the
    chart needs could not be loaded, such as a web page's payload), or
    ``"render-failed"``.
    ``path`` is where in the chart's options (``"marks[1].color"``, or for
    a mark's own options ``"color"``), ``mark`` the mark (its ``id``, or its
    index among the chart's marks), ``panel`` the panel, and ``phase`` when
    it happened: ``"validate"``, ``"compile"``, ``"load"``, ``"layout"``,
    or ``"render"``. The message is shaped "location: problem; correction".
    """

    code: ChartErrorCode
    path: str | None
    mark: str | int | None
    panel: str | None
    phase: ChartErrorPhase
    # Its path is relative to the function or object of options it leaves
    # (see `Role`), which their callers place; paths given as it is made
    # (``path=``) are where in the chart it is.
    _relative = False
    # For an object of options, where its holder said it was given ("Theme
    # tokens", see `placed`).
    _place: str | None = None

    def __init__(
        self,
        message: str,
        *,
        code: ChartErrorCode = "invalid-option",
        path: str | None = None,
        mark: str | int | None = None,
        panel: str | None = None,
        phase: ChartErrorPhase = "validate",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.mark = mark
        self.panel = panel
        self.phase = phase

    @property
    def message(self) -> str:
        return str(self)

    def info(self) -> dict[str, Any]:
        """The error as the spec's ``ChartErrorInfo``: JSON-safe, as other runtimes take it."""
        info: dict[str, Any] = {"code": self.code, "message": self.message, "phase": self.phase}
        for name in ("path", "mark", "panel"):
            value = getattr(self, name)
            if value is not None:
                info[name] = value
        return info

    @classmethod
    def from_info(cls, info: Mapping[str, Any], message: str | None = None) -> ChartError:
        """An error the JavaScript engine reported (``ChartErrorInfo``), its
        path in Python's spelling: option names in snake_case."""
        path = info.get("path")
        return cls(
            info["message"] if message is None else message,
            code=info.get("code", "invalid-option"),
            path=python_path(path) if isinstance(path, str) else None,
            mark=info.get("mark"),
            panel=info.get("panel"),
            phase=info.get("phase", "validate"),
        )


# Segments after these name what the chart's author named (scales, tables,
# columns), which keep their spelling.
_NAMED = {"scales", "data", "columns", "map", "panels"}


# A path's parts: names, dots, and indices or quoted keys in brackets.
_PART = re.compile(r'\[(?:\d+|"(?:[^"\\]|\\.)*")\]|\.|[^.\[]+')


#: Keys written after a dot in paths; others go in brackets, quoted (``scales["p.99"]``).
_NAME = re.compile(r"^[A-Za-z_$][\w$]*$", re.ASCII)


class UnknownOption(TypeError):
    """A keyword argument a function does not take: a TypeError, as Python
    raises for one, with herceg's suggestion of what was meant."""


def unknown_option(owner: str, name: str, known: Collection[str]) -> UnknownOption:
    """``owner`` given ``name``, which it does not take: with the option most like it."""
    close = difflib.get_close_matches(name, sorted(known), n=1, cutoff=0.7)
    hint = (
        f"did you mean {close[0]!r}?"
        if close
        else f"see help(herceg.{owner}) for the options it takes"
    )
    return UnknownOption(f"{owner}: no option {name!r}; {hint}")


@dataclass(frozen=True)
class Role:
    """Where an option is: as a refusal says it (``label``, "line
    stroke_width") and as its ``path`` (``stroke_width``), relative to the
    function or object of options checking it, which its caller places
    (see `located`). ``Role("Chart").field("sync").field("cursor")`` is
    "Chart sync cursor", at ``sync.cursor``."""

    label: str
    path: str | None = None

    def field(self, name: str) -> Role:
        return Role(f"{self.label} {name}", _joined(self.path, name))

    def index(self, index: int) -> Role:
        return Role(f"{self.label}[{index}]", _joined(self.path, f"[{index}]"))

    def key(self, key: str) -> Role:
        """A key its author named (a scale's): kept whole (see `key_path`)."""
        return Role(f"{self.label} {key}", key_path(self.path, key))

    def check(self, check: Callable[[Any, str], _T], value: Any) -> _T:
        """``check(value, label)``, a check refusing in words (as "Chart
        width: ..."), its refusal at this role."""
        return located(self, lambda: check(value, self.label))

    def error(self, problem: str, *, code: ChartErrorCode = "invalid-option") -> ChartError:
        """A refusal of the option: "label: problem; correction"."""
        error = ChartError(f"{self.label}: {problem}", code=code, path=self.path)
        error._relative = True
        return error

    def __str__(self) -> str:
        return self.label


def located(at: str | Role | None, make: Callable[[], _T], *spelled: str) -> _T:
    """``make()``, which checks what is given at ``at`` (``guides[0]``, a
    role), its refusals placed there: within it, for paths relative to it.
    A refusal ``make`` words as the object, spelled as one of `spelled`
    (``"Navigator"``), is at the option it names (``Navigator height`` at
    ``navigator.height``)."""
    try:
        return make()
    except ChartError as error:
        where = at.path if isinstance(at, Role) else at
        raise _moved(error, spelled, None, where, None, None) from None


class refusing:
    """Places the ChartErrors checking options at ``at`` raises (the
    options of one of `owners`, ``"line"``, ``"Chart"``), of `mark`, in
    `panel`. A refusal whose path is relative (see `Role`) is placed within
    ``at``; one raised without a path, worded "owner option: ..." with one
    of `options` (``"line stroke_width: ..."``, ``"Chart bindings[0]:
    ..."``), is at that option within ``at`` (``marks[2].stroke_width``
    with ``at`` ``"marks[2]"``), and other refusals at ``at``. An object of
    options made from a dict where its holder said (see `placed`) is placed
    at that option. ChartErrors that say where in the chart they are keep
    their paths; other errors propagate as they are. (A class, not a
    generator: it frames every option a chart checks.)"""

    def __init__(
        self,
        owners: Collection[str],
        options: Collection[str] | None = (),
        at: str | None = None,
        *,
        mark: str | int | None = None,
        panel: str | None = None,
    ) -> None:
        self.frame = (owners, options, at, mark, panel)

    def __enter__(self) -> None:
        return None

    def __exit__(self, kind: object, error: BaseException | None, traceback: object) -> None:
        if isinstance(error, ChartError):
            raise _moved(error, *self.frame) from None


def _moved(
    error: ChartError,
    owners: Collection[str],
    options: Collection[str] | None,
    at: str | None,
    mark: str | int | None,
    panel: str | None,
) -> ChartError:
    """`error` leaving the frame at ``at`` (see `refusing`)."""
    if error._relative or error.path is None:
        # A refusal raised without a path is where its words say, as plain errors are.
        inner = error.path if error.path is not None else _option(str(error), owners, options)
        if error._place is not None:
            inner = _joined(_option(f"{error._place}: ", owners, options), inner)
        path, relative = _joined(at, inner), True
    else:
        path, relative = error.path, False
    if (
        path == error.path
        and relative == error._relative
        and error._place is None
        and (error.mark is not None or mark is None)
        and (error.panel is not None or panel is None)
    ):
        return error
    moved = ChartError(
        str(error),
        code=error.code,
        path=path,
        mark=error.mark if error.mark is not None else mark,
        panel=error.panel if error.panel is not None else panel,
        phase=error.phase,
    )
    moved._relative = relative
    moved.__traceback__ = error.__traceback__
    return moved


def placed(role: str | Role, make: Callable[[], _T]) -> _T:
    """``make()``, which makes or serializes an object of options given at
    ``role``: its refusals, relative to it, placed there. A role in words
    (``"Theme tokens"``) is said to the holder, which places it at its
    option (``tokens``)."""
    if isinstance(role, Role):
        return located(role, make)
    try:
        return make()
    except ChartError as error:
        if error._relative and error._place is None:
            error._place = role
        raise


_C = TypeVar("_C", bound=type)


def refuses(cls: _C) -> _C:
    """Makes what a class of options refuses as it is made (its
    ``__post_init__``) or as a chart takes it (its ``_spec``) ChartErrors at
    the field a refusal names (``hg.Stack(offset="up")`` at ``offset``),
    relative to the object, and refuses its fields typed with Python's
    type hints given as anything else (see `Hint`). Put it above ``@dataclass``."""
    # Refusals name the object by its class, or as its maker does (`_spelled`:
    # hg.axis's are "axis ...").
    spelled = getattr(cls, "_spelled", ())
    owners = (cls.__name__, f"hg.{cls.__name__}", *spelled)
    names = {field.name for field in dataclasses.fields(cls)}
    # Hints are checked as the object is made, or else as a chart takes it.
    first = "__post_init__" if "__post_init__" in vars(cls) else "_spec"

    def checked(method: Callable[..., _T]) -> Callable[..., _T]:
        @functools.wraps(method)
        def check(self: Any, *args: Any, **kwargs: Any) -> _T:
            try:
                with refusing(owners, names):
                    if method.__name__ != first:
                        return method(self, *args, **kwargs)
                    hints = hints_of(cls)
                    given = {name: getattr(self, name) for name in hints}
                    owner = (*spelled, cls.__name__)[0]
                    changed, later = python_values(owner, given, hints)
                    for name, value in changed.items():
                        object.__setattr__(self, name, value)
                    result = method(self, *args, **kwargs)
                    # Last, for what the object's own checks let through: theirs say more.
                    check_hints(owner, given, later)
                    return result
            except ChartError as error:
                # Paths an object's checks give are within the object.
                error._relative = True
                raise

        return check

    for name in ("__post_init__", "_spec"):
        if name in vars(cls):
            setattr(cls, name, checked(vars(cls)[name]))
    return cls


@dataclass(frozen=True)
class Hint:
    """What an option's type hint says Python checks of it. One typed with
    Python's scalars alone (``bool``, ``float | None``, ``Literal["x",
    "y"]``) takes text, True or False, whole numbers, numbers, or its
    literal choices, as its `kinds` and `choices` say. One that takes
    objects too (`others`, as refusals word them: "an hg.BarLabels") takes
    lists, dicts, and functions where it names them (see `shaped`), and its
    own checks judge the rest. Subclasses count (a ``str`` enum is text,
    ``Fraction`` a number), and NumPy's scalars are taken as Python's (see
    `_plain`). A fixed-length tuple (a pair, a box) is taken as a tuple from
    any list, array, Series, or iterator of its values (see `tupled`), and
    an array or a Series where a list goes (and no array) as a list of its
    values (see `_values`), each taken as the list's `items` say, and a
    dict's values as its `keys` say (see `parts_taken`), so that what runs
    next sees the types hinted."""

    kinds: frozenset[type]
    choices: tuple[Any, ...]
    optional: bool
    others: tuple[str, ...] = ()
    # What it takes besides scalars: sequences, arrays, dicts (or herceg's
    # objects, which are made from dicts), functions, and fixed-length
    # tuples (their lengths, outermost first).
    lists: bool = False
    arrays: bool = False
    dicts: bool = False
    functions: bool = False
    durations: bool = False
    fixed: tuple[int, ...] = ()
    # What its lists hold (``Sequence[str]``: text), and its dicts' keys
    # (of a ``TypedDict``), where herceg can say.
    items: Hint | None = None
    keys: tuple[tuple[str, Hint], ...] = ()
    # What each place of a fixed-length tuple holds, where herceg can say.
    positions: tuple[Hint | None, ...] = ()

    def taken(self, value: Any) -> tuple[bool, Any]:
        """Whether `value` is taken, and as what (see `_plain`)."""
        if value is None:
            return self.optional, None
        # A 0-d array is a number only where an option takes no arrays.
        value = _plain(value, arrays=not self.others)
        if not (self.functions and callable(value)):
            # A list where lists go too stays one (reading it as a pair would cut it short).
            if self.fixed and not self.lists and tuplable(value):
                value = tupled(value, self.fixed)
            elif self.lists and not self.arrays and _array_like(value):
                value = _values(value)
        if not self.shaped(value):
            return False, value
        if isinstance(value, np.timedelta64) and not self.durations:
            return False, value  # a NumPy integer, but of its unit: no number
        if self.others and not isinstance(value, (str, bool, numbers.Number)):
            return True, value  # its own checks judge objects
        if isinstance(value, bool):
            return bool in self.kinds or any(choice is value for choice in self.choices), value
        if isinstance(value, str):
            # A word: which the option takes, its own check says, with what to do instead.
            return str in self.kinds or any(type(c) is str for c in self.choices), value
        if isinstance(value, numbers.Integral):
            whole = any(type(c) is int and c == value for c in self.choices)
            return whole or bool(self.kinds & {int, float}), value
        if isinstance(value, numbers.Real):
            if float in self.kinds:
                return True, value  # which numbers it takes, its own check says
            # A whole number computed as a float (800.0) is one.
            whole = int in self.kinds and float(value).is_integer()
            return whole, int(float(value)) if whole else value
        return False, value

    def shaped(self, value: Any) -> bool:
        """Whether `value` is of a shape the option takes: a function where
        it names functions (whatever else the object is), a dict where it
        names dicts, a list or an array where it names lists or arrays,
        an iterator nowhere (reading it to check it would use it up; a
        fixed-length tuple has been read from it), and other values as its
        own checks judge them."""
        if self.functions and callable(value):
            return True
        if isinstance(value, (str, bytes)):
            return True
        if isinstance(value, Mapping):
            return self.dicts
        if isinstance(value, Iterator):
            return False
        if isinstance(value, np.ndarray) and value.ndim == 0:
            return self.arrays
        if _listed(value):
            return self.lists or self.arrays or (bool(self.fixed) and isinstance(value, tuple))
        return True

    def expected(self) -> str:
        return listed_words(
            [
                *(shown(choice) for choice in self.choices),
                *(["a string"] if str in self.kinds else []),
                *(["True", "False"] if bool in self.kinds else []),
                *(["a whole number"] if int in self.kinds and float not in self.kinds else []),
                *(["a finite number"] if float in self.kinds else []),
                *self.others,
            ]
        )


_SCALARS = (str, bool, int, float)


def _plain(value: Any, *, arrays: bool) -> Any:
    """`value` as Python's scalar where it is NumPy's (a number, a flag, and
    with `arrays` a 0-d array of one), and text of a subclass (a ``str``
    enum, ``np.str_``) as text. NumPy's dates and times stay as they are:
    their units matter."""
    if arrays and isinstance(value, np.ndarray) and value.ndim == 0 and value.dtype.kind in "biuf":
        return value.item()
    # NumPy's durations are integers of their unit, which they keep.
    if isinstance(value, (np.bool_, np.integer, np.floating)) and not isinstance(
        value, np.timedelta64
    ):
        return value.item()
    if isinstance(value, str) and type(value) is not str:
        return str.__str__(value)
    return value


def _listed(value: Any) -> bool:
    """Whether `value` is given as several values: a collection other than
    text or a mapping (a list, a tuple, a set, a range), an array, or what
    NumPy reads as one (a pandas or Polars Series, an Index, an Arrow
    array), but no NumPy scalar."""
    if isinstance(value, (str, bytes, Mapping, np.generic)):
        return False
    return isinstance(value, (Collection, np.ndarray)) or hasattr(value, "__array__")


def tuplable(value: Any) -> bool:
    """Whether a fixed-length tuple is read from `value`: a list, a tuple, an
    array of at least one dimension, a Series, or an iterator, but not a set
    (whose order is not its own)."""
    if isinstance(value, Iterator):
        return True
    if isinstance(value, np.ndarray):
        return value.ndim > 0
    return _listed(value) and not isinstance(value, AbstractSet)


def tupled(value: Any, lengths: tuple[int, ...]) -> tuple[Any, ...]:
    """`value` as a tuple of its values in order (a Series' by position, not
    its index), NumPy's scalars as Python's, and nested values as tuples
    where the hint nests them (``lengths``, outermost first). An iterator is
    read for at most one value past the length, which its holder's check
    then refuses."""
    items = tuple(itertools.islice(iter(value), lengths[0] + 1))
    inner = lengths[1:]
    return tuple(
        tupled(item, inner) if inner and tuplable(item) else _plain(item, arrays=False)
        for item in items
    )


def _array_like(value: Any) -> bool:
    """Whether `value` is an array of values but no sequence: a NumPy array
    of at least one dimension, or what NumPy reads as one (a pandas or
    Polars Series, an Index)."""
    if isinstance(value, np.ndarray):
        return value.ndim > 0
    return (
        hasattr(value, "__array__")
        and not isinstance(value, (np.generic, str, bytes, Mapping))
        and not isinstance(value, Sequence)
    )


def _values(value: Any) -> list[Any]:
    """An array's or a Series' values as a list, in order (by position, not
    by index); its items are taken as the list's hint says (see
    `parts_taken`)."""
    return list(value)


def parts_taken(at: Role, hint: Hint, value: Any, *, first: bool = False) -> tuple[Any, bool]:
    """`value`, which `hint` takes at `at`, with its parts as the hint says:
    a list's items as its `items` take them, a fixed-length tuple's as its
    `positions`, a dict's values as its `keys`
    (NumPy's scalars as Python's, arrays where lists or pairs go as those,
    and so on down), and whether some part is left to be refused. A part
    not taken is refused at its place (``values[1]``, ``layout.sort``);
    `first`, before a function's own checks, only where it would break
    them (a missing value, pandas' NA among them, which has no truth, or a
    list where one value goes) and otherwise left to them."""
    parts: list[tuple[Any, Any, Hint]]
    if hint.items is not None and isinstance(value, (list, tuple)):
        parts = [(i, item, hint.items) for i, item in enumerate(value)]
        place: Callable[[Any], Role] = at.index
    elif hint.positions and isinstance(value, tuple):
        known = zip(value, hint.positions, strict=False)
        parts = [(i, item, within) for i, (item, within) in enumerate(known) if within]
        place = at.index
    elif hint.keys and isinstance(value, Mapping):
        parts = [(key, value[key], within) for key, within in hint.keys if key in value]
        place = at.key
    else:
        return value, False
    out: Any = None
    left = False
    for part, given, within in parts:
        taken, made = within.taken(given)
        if not taken:
            if first and not _breaking(within, given):
                left = True
                continue
            raise _refusal(place(part), within, given)
        made, inner = parts_taken(place(part), within, made, first=first)
        left = left or inner
        if made is not given:
            out = (
                (dict(value) if isinstance(value, Mapping) else list(value)) if out is None else out
            )
            out[part] = made
    if out is None:
        return value, left
    return (tuple(out) if isinstance(value, tuple) else out), left


def _breaking(hint: Hint, value: Any) -> bool:
    """Whether `value`, which `hint` does not take, would break a function's
    own checks of it, so is refused before them: a missing value (pandas'
    NA has no truth), a shape the hint does not take (a list where one
    value goes), or a NumPy duration (which passes for a number)."""
    return _missing(value) or not hint.shaped(value) or isinstance(value, np.timedelta64)


def _missing(value: Any) -> bool:
    """Whether `value` is no value: None, pandas' NA or NaT, NumPy's NaT."""
    if value is None or type(value).__name__ in ("NAType", "NaTType"):
        return True
    return isinstance(value, np.datetime64) and bool(np.isnat(value))


def _structure(member: Any) -> str | None:
    """What a member of a hint takes besides scalars, by its type: "lists"
    (a sequence other than text), "arrays", "dicts" (a mapping, or one of
    herceg's objects of options, which are made from dicts), "functions",
    or None."""
    kind = typing.get_origin(member) or member
    if kind is CallableABC:
        return "functions"
    if not isinstance(kind, type):
        return None
    if issubclass(kind, Mapping) or typing.is_typeddict(kind):
        return "dicts"
    if issubclass(kind, Sequence) and kind not in (str, bytes):
        return "lists"
    if kind is np.ndarray:
        return "arrays"
    herceg = kind.__module__.startswith("herceg") and not kind.__name__.startswith("_")
    return "dicts" if herceg and kind.__name__ != "Expr" else None


def _keys(dicts: list[Any]) -> tuple[tuple[str, Hint], ...]:
    """The hints of the keys of `dicts` (``TypedDict`` classes), each key's
    the union of its hints where several name it (a layout's ``type``)."""
    found: dict[str, list[Any]] = {}
    for kind in dicts:
        names = {**vars(sys.modules[__package__]), **vars(sys.modules[kind.__module__])}
        for key, annotation in typing.get_type_hints(kind, globalns=names).items():
            found.setdefault(key, []).append(annotation)
    keys = []
    for key, hints in found.items():
        if (made := _hint(functools.reduce(operator.or_, hints))) is not None:
            keys.append((key, made))
    return tuple(keys)


def _positions(tuples: list[tuple[Any, ...]], sequences: list[Any]) -> tuple[Hint | None, ...]:
    """The hints of each place of fixed-length tuples (their hints' args),
    a place several name taking the union of their hints, and of what the
    hint's `sequences` hold: a tuple may be one of its lists too (a pair
    of bins, one per axis, or two edges)."""
    places: list[list[Any]] = []
    for args in tuples:
        for i, arg in enumerate(args):
            if i == len(places):
                places.append([])
            places[i].append(arg)
    held = [args[0] for args in map(typing.get_args, sequences) if args and args[0] is not Ellipsis]
    return tuple(_hint(functools.reduce(operator.or_, hints + held)) for hints in places)


def _items(member: Any) -> Hint | None:
    """The hint of what a sequence hint's lists hold (``Sequence[str]``:
    text; ``tuple[str, ...]`` too)."""
    args = typing.get_args(member)
    return _hint(args[0]) if args and args[0] is not Ellipsis else None


def _word(hint: Any) -> str | None:
    """A kind of object as refusals name what an option takes, if herceg can say."""
    kind = typing.get_origin(hint) or hint
    if kind is CallableABC:
        return "a function"
    if not isinstance(kind, type):
        return None
    if issubclass(kind, (datetime.date, np.datetime64)):
        return "a date or time"
    if issubclass(kind, (datetime.timedelta, np.timedelta64)):
        return "a timedelta"
    if issubclass(kind, Mapping):
        return "a dict"
    if issubclass(kind, Sequence) and kind not in (str, bytes):
        return "a list"
    if kind is np.ndarray:
        return "an array"
    if kind is bytes:
        return "bytes"
    if issubclass(kind, os.PathLike):
        return "a path"
    if kind.__module__.startswith("herceg") and not kind.__name__.startswith("_"):
        if kind.__name__ == "Expr":
            return "an expression"
        return f"an hg.{kind.__name__}"
    return None


def _lengths(hint: Any) -> tuple[int, ...]:
    """The lengths of a fixed-length tuple hint and the tuples it nests,
    outermost first (``tuple[tuple[float, float], tuple[float, float]]``:
    2 and 2); none for a tuple of any length (``tuple[str, ...]``)."""
    args = typing.get_args(hint)
    if not args or Ellipsis in args:
        return ()
    nested = [_lengths(arg) for arg in args if typing.get_origin(arg) is tuple]
    inner = max(nested, key=len, default=())
    return (len(args), *inner)


def _hint(hint: Any) -> Hint | None:
    union = typing.get_origin(hint) in (typing.Union, types.UnionType)
    members = typing.get_args(hint) if union else (hint,)
    kinds: set[type] = set()
    choices: list[Any] = []
    others: list[str] = []
    optional = False
    flags = {"lists": False, "arrays": False, "dicts": False, "functions": False}
    flags["durations"] = any(
        isinstance(member, type) and issubclass(member, (datetime.timedelta, np.timedelta64))
        for member in members
    )
    fixed: tuple[int, ...] = ()
    sequences = []
    dicts = []
    tuples = []
    for member in members:
        if member is type(None):
            optional = True
        elif member in _SCALARS:
            kinds.add(member)
        elif typing.get_origin(member) is Literal:
            choices.extend(typing.get_args(member))
        elif (word := _word(member)) is not None:
            if typing.get_origin(member) is tuple and (lengths := _lengths(member)):
                # Pairs of several shapes (a range, or one per axis) are read alike.
                fixed = max(fixed, lengths, key=len)
                tuples.append(typing.get_args(member))
                word = "a pair" if lengths[0] == 2 else f"a list of {lengths[0]}"
            elif (structure := _structure(member)) is not None:
                flags[structure] = True
                if structure == "lists":
                    sequences.append(member)
                elif typing.is_typeddict(member):
                    dicts.append(member)
            if word not in others:
                others.append(word)
        else:
            return None  # a hint herceg cannot say in words
    if not (kinds or choices or others):
        return None
    return Hint(
        frozenset(kinds),
        tuple(choices),
        optional,
        tuple(others),
        fixed=fixed,
        # Of one kind of list alone: which a list is of several (or a pair
        # of lists) is its holder's to say.
        items=_items(sequences[0]) if len(sequences) == 1 and not fixed else None,
        keys=_keys(dicts),
        positions=_positions(tuples, sequences),
        **flags,
    )


def _names(owner: Any) -> dict[str, Any]:
    """The names `owner`'s hints read: its module's, and herceg's for those
    a module imports only for type checking."""
    return {**vars(sys.modules[__package__]), **vars(sys.modules[owner.__module__])}


@functools.cache
def hints_of(owner: Callable[..., Any]) -> Mapping[str, Hint]:
    """The parameters of a function (with the keywords of options it
    unpacks), or the fields of a class of options, whose type hints Python
    checks (see `Hint`)."""
    hints = typing.get_type_hints(owner, globalns=_names(owner))
    if isinstance(owner, type):
        hints = {field.name: hints[field.name] for field in dataclasses.fields(owner)}
    found: dict[str, Hint] = {}
    for name, hint in hints.items():
        if typing.get_origin(hint) is Unpack:
            (options,) = typing.get_args(hint)
            found |= {
                key: made
                for key, value in typing.get_type_hints(options).items()
                if (made := _hint(value)) is not None
            }
        elif (made := _hint(hint)) is not None:
            found[name] = made
    return found


def is_number(value: object) -> TypeGuard[float]:
    """Whether `value` is a real number (a flag is one too, as Python has
    it), but no NumPy duration, which is an integer of its unit."""
    return isinstance(value, numbers.Real) and not isinstance(value, np.timedelta64)


def is_integer(value: object) -> TypeGuard[int]:
    """Whether `value` is an integer (see `is_number`)."""
    return isinstance(value, numbers.Integral) and not isinstance(value, np.timedelta64)


def take(at: Role, hint: Hint, value: Any) -> Any:
    """`value` as `hint` takes it at `at`, its parts too (see `parts_taken`);
    refused there if not."""
    taken, made = hint.taken(value)
    if not taken:
        raise _refusal(at, hint, value)
    return parts_taken(at, hint, made)[0]


def check_hints(
    owner: str | Role, values: Mapping[str, Any], hints: Mapping[str, Hint]
) -> dict[str, Any]:
    """Refuses those of `hints` given in `values` as anything they do not
    take (``line dodge: expected True or False; received None``), at the
    option of `owner` (its name, or its role); returns what it takes as
    other values (see `python_values`)."""
    changed = {}
    for name, hint in sorted(hints.items()):
        if name in values:
            value = take(_role(owner).field(name), hint, values[name])
            if value is not values[name]:
                changed[name] = value
    return changed


def python_values(
    owner: str | Role, values: Mapping[str, Any], hints: Mapping[str, Hint]
) -> tuple[dict[str, Any], dict[str, Hint]]:
    """Those of `hints` given in `values` that are taken as other values
    (NumPy's scalars as Python's, and whole numbers computed as floats as
    ints), and the hints of values not taken, which a function's own checks
    judge first and `check_hints` refuses after them. None where an option
    does not take it, and lists, arrays, and dicts of a kind it does not
    take, are refused at once (as `check_hints` does)."""
    changed: dict[str, Any] = {}
    later: dict[str, Hint] = {}
    for name, hint in hints.items():
        given = values.get(name, _ABSENT)
        if given is _ABSENT or (given is None and hint.optional):
            continue  # most options are left out
        taken, value = hint.taken(given)
        if not taken:
            if _breaking(hint, given):
                raise _refusal(_role(owner).field(name), hint, given)
            later[name] = hint
            continue
        value, left = parts_taken(_role(owner).field(name), hint, value, first=True)
        if left:
            later[name] = hint
        if value is not given:
            changed[name] = value
    return changed, later


_ABSENT = object()


def _role(owner: str | Role) -> Role:
    return owner if isinstance(owner, Role) else Role(owner)


def _refusal(at: Role, hint: Hint, given: Any) -> ChartError:
    if isinstance(given, Iterator):
        return at.error(
            f"expected {hint.expected()}; received an iterator, which checking would use up; "
            "give a list of its values"
        )
    return at.error(f"expected {hint.expected()}; received {shown(given)}")


class Arguments:
    """How a function of named parameters (none positional-only, no
    ``*args`` or ``**kwargs``) names the arguments of a call, as
    ``inspect.Signature.bind_partial`` does, at a fraction of its cost
    (every mark a chart takes pays it)."""

    def __init__(self, function: Callable[..., Any]) -> None:
        parameters = inspect.signature(function).parameters.values()
        if any(
            parameter.kind
            in (parameter.POSITIONAL_ONLY, parameter.VAR_POSITIONAL, parameter.VAR_KEYWORD)
            for parameter in parameters
        ):
            raise TypeError(f"{function.__qualname__}: bind its calls with inspect")
        self.names = tuple(
            parameter.name
            for parameter in parameters
            if parameter.kind is parameter.POSITIONAL_OR_KEYWORD
        )

    def of(self, args: tuple[Any, ...], kwargs: Mapping[str, Any]) -> dict[str, Any] | None:
        """The call's arguments by name; None for a call Python refuses
        (too many positional arguments, or one given twice)."""
        if len(args) > len(self.names) or any(name in kwargs for name in self.names[: len(args)]):
            return None
        given = dict(zip(self.names, args, strict=False))
        given.update(kwargs)
        return given

    def replaced(
        self, args: tuple[Any, ...], kwargs: dict[str, Any], changed: Mapping[str, Any]
    ) -> tuple[tuple[Any, ...], dict[str, Any]]:
        """The call's arguments with those `changed` replaced."""
        if not changed:
            return args, kwargs
        positional, named = list(args), dict(kwargs)
        for name, value in changed.items():
            if name in named:
                named[name] = value
            else:
                positional[self.names.index(name)] = value
        return tuple(positional), named


_F = TypeVar("_F", bound=Callable[..., Any])


def hinted(cls: _C) -> _C:
    """Checks the fields of a class of options a chart takes with its
    ``_spec(role)`` (or a sync channel's ``_show(role)``) by their type
    hints (see `Hint`), at the role's fields: NumPy's scalars taken as
    Python's first, and what the class's own checks let through refused
    after them."""

    def check(method: Callable[..., _T]) -> Callable[..., _T]:
        @functools.wraps(method)
        def checked(self: Any, role: Role, *args: Any, **kwargs: Any) -> _T:
            hints = hints_of(cls)
            given = {name: getattr(self, name) for name in hints}
            changed, later = python_values(role, given, hints)
            for name, value in changed.items():
                object.__setattr__(self, name, value)
            made = method(self, role, *args, **kwargs)
            check_hints(role, given, later)
            return made

        return checked

    for name in ("_spec", "_show"):
        if name in vars(cls):
            setattr(cls, name, check(vars(cls)[name]))
    return cls


def checks_hints(owner: str) -> Callable[[_F], _F]:
    """Checks a public function's options by their type hints (see `Hint`)
    before it runs, as `owner` (``"to_png"``), and passes NumPy's scalars on
    as Python's."""

    def decorate(function: _F) -> _F:
        signature = inspect.signature(function)
        unpacked = next(
            (
                name
                for name, parameter in signature.parameters.items()
                if parameter.kind is parameter.VAR_KEYWORD
            ),
            None,
        )

        @functools.wraps(function)
        def checked(*args: Any, **kwargs: Any) -> Any:
            try:
                bound = signature.bind(*args, **kwargs)
            except TypeError:
                return function(*args, **kwargs)  # Python says what the call lacks
            given = dict(bound.arguments)
            if unpacked is not None:
                given |= given.pop(unpacked, {})
            changed = check_hints(owner, given, hints_of(function))
            if not changed:
                return function(*args, **kwargs)
            for name, value in changed.items():
                if name in bound.arguments:
                    bound.arguments[name] = value
                else:
                    bound.arguments[unpacked][name] = value  # type: ignore[index]
            return function(*bound.args, **bound.kwargs)

        return typing.cast("_F", checked)

    return decorate


def shown(value: Any) -> str:
    """A value as error messages quote it: text in double quotes, Python's repr otherwise."""
    return json.dumps(value) if isinstance(value, str) else repr(value)


def keys_shown(keys: Collection[Any]) -> str:
    """A dict's keys as error messages list them, in order of their text
    (keys of different types do not sort among themselves)."""
    return ", ".join(sorted(map(shown, keys)))


def listed(choices: Collection[Any]) -> str:
    """Choices as error messages list them: "a", "b", or "c"."""
    return listed_words([shown(choice) for choice in choices])


def listed_words(items: list[str]) -> str:
    if len(items) <= 2:
        return " or ".join(items)
    return f"{', '.join(items[:-1])}, or {items[-1]}"


def _option(message: str, owners: Collection[str], options: Collection[str] | None) -> str | None:
    """The option a refusal's location (what it says before ": ") names
    after one of `owners` (see `refusing`), with a list's index
    (``bindings[0]``), if it is one of `options` (any, for None)."""
    words = message.split(": ", 1)[0]
    # Said by the option's name alone, as a keyword is ("data: ...").
    if options is not None and _INDEXED.sub("", words) in options:
        return words
    for owner in owners:
        if words.startswith(f"{owner} "):
            option = words[len(owner) + 1 :].split(" ")[0]
            if options is None or _INDEXED.sub("", option) in options:
                return option
    return None


# A list's indexes or a dict's keys after an option's name: bindings[0],
# layers[1][2], layout["seed"].
_INDEXED = re.compile(r'(\[(?:\d+|"[^"]*")\])+$')


def renamed(error: ChartError, old: str, new: str) -> ChartError:
    """`error` as `new` says it where it says `old` first (``to_pdf margin:
    ...`` as ``save margin: ...``), its fields kept."""
    message = str(error)
    if not message.startswith(f"{old} "):
        return error
    return ChartError.from_info(error.info(), new + message[len(old) :])


def _joined(at: str | None, path: str | None) -> str | None:
    """``path`` within ``at``: after a dot, or for an index, directly."""
    if not at or not path:
        return at or path or None
    return f"{at}{'' if path[0] == '[' else '.'}{path}"


def key_path(at: str | None, key: str) -> str:
    """The path of ``key`` under ``at``: after a dot, or for a key that is no
    name, quoted in brackets, so the path keeps it whole (``scales["p.99"]``)."""
    part = key if _NAME.match(key) else f"[{json.dumps(key)}]"
    return f"{at}{'' if part[0] == '[' else '.'}{part}" if at else part


def python_path(path: str) -> str:
    """A spec path (``marks[1].strokeWidth``) in Python's spelling
    (``marks[1].stroke_width``): option names in snake_case, never the
    names of columns, scales, tables, or ids, nor keys in brackets
    (``map["usEast"]``)."""
    out = []
    named = False
    for part in _PART.findall(path):
        if part == ".":
            out.append(part)
        elif part.startswith("["):
            out.append(part)
            named = False
        else:
            out.append(part if named else _snake(part))
            named = part in _NAMED
    return "".join(out)


def _snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: f"_{m.group(1).lower()}", name)
