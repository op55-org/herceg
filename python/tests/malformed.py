"""Malformed values of an argument or a field, from its type hint, and what a
refusal of one must be: a ChartError at the argument, or within it."""

from __future__ import annotations

import datetime as dt
import inspect
import sys
import types
import typing
from collections.abc import Iterator, Mapping, Sequence
from typing import Any

import numpy as np
import pandas as pd

if sys.version_info >= (3, 11):
    from typing import Unpack
else:
    from typing_extensions import Unpack

import herceg as hg

# Arguments that take any object: no value of the wrong type for them is invalid as such.
TAKES_ANYTHING = {"self"}


def _union(hint: Any) -> tuple[Any, ...]:
    if typing.get_origin(hint) in (typing.Union, types.UnionType):
        return tuple(arg for member in typing.get_args(hint) for arg in _union(member))
    return (hint,)


def _choices(hint: Any) -> tuple[list[Any], bool]:
    """The literal choices a hint allows, and whether it takes any string."""
    choices: list[Any] = []
    strings = False
    for member in _union(hint):
        if member is str:
            strings = True
        elif typing.get_origin(member) is typing.Literal:
            choices.extend(typing.get_args(member))
    return choices, strings


def _kinds(hint: Any) -> list[type]:
    kinds = []
    for member in _union(hint):
        origin = typing.get_origin(member) or member
        if typing.is_typeddict(origin):
            kinds.append(dict)
        elif isinstance(origin, type):
            kinds.append(origin)
    return kinds


def _invalid(hint: Any) -> Any:
    """A value a hint refuses: a word outside its choices, or an object of no
    type it takes (None for a hint taking anything)."""
    if hint is Any or hint is object:
        return None
    choices, strings = _choices(hint)
    return "__invalid__" if choices and not strings else object()


def _takes_lists(hint: Any) -> bool:
    """Whether a hint takes lists: it names a sequence (a tuple too), what
    holds lists (``Iterable``), or arrays."""
    if hint in (None, Any, object) or any(member is Any for member in _union(hint)):
        return True
    return any(
        (issubclass(kind, Sequence) and kind not in (str, bytes))
        or issubclass(list, kind)
        or kind is np.ndarray
        for kind in _kinds(hint)
    )


def _takes_arrays(hint: Any) -> bool:
    """Whether a hint takes NumPy's arrays as such (or anything)."""
    if hint in (None, Any, object) or any(member is Any for member in _union(hint)):
        return True
    return any(kind is np.ndarray or issubclass(np.ndarray, kind) for kind in _kinds(hint))


def _fixed(member: Any) -> bool:
    args = typing.get_args(member)
    return typing.get_origin(member) is tuple and bool(args) and Ellipsis not in args


def _takes_sequences_alone(hint: Any) -> bool:
    """Whether a hint takes lists as sequences (not any iterable, nor fixed
    tuples read from one)."""
    members = _union(hint)
    if any(member is Any or _fixed(member) for member in members):
        return False
    kinds = _kinds(hint)
    sequences = any(issubclass(kind, Sequence) and kind not in (str, bytes) for kind in kinds)
    return sequences and not any(
        issubclass(list, kind) and not issubclass(kind, Sequence) for kind in kinds
    )


def _takes_dicts(hint: Any) -> bool:
    """Whether a hint takes dicts: it names one, or herceg's objects of
    options (which are made from dicts)."""
    if hint in (None, Any, object):
        return True
    return any(
        issubclass(kind, Mapping) or kind.__module__.startswith("herceg") for kind in _kinds(hint)
    )


def _shapes(hint: Any) -> list[Any]:
    """Values of a wrong shape for a hint taking lists or dicts: a number
    where only lists go, a list holding an object of no type, one holding a
    list (which no set holds), a 0-d array, and a dict with an object, a key
    that is no name, or keys of two types (which do not sort together);
    refused, if at all, within the argument."""
    kinds = _kinds(hint)
    lists = _takes_lists(hint)
    dicts = any(issubclass(kind, Mapping) for kind in kinds)
    numbers = any(kind in (int, float) for kind in kinds)
    return [
        *([5] if lists and not numbers else []),
        *([[object()], [[]], np.array(2)] if lists else []),
        *([{"__invalid__": object()}, {1: 1}, {"__invalid__": 1, 1: 2}] if dicts else []),
    ]


def _takes_none(hint: Any) -> bool:
    return hint in (None, Any, object) or any(
        member is type(None) or member is None or member is Any for member in _union(hint)
    )


def _scalars_only(hint: Any) -> bool:
    """Whether a hint takes Python's scalars and words alone (no lists, no objects)."""
    members = [member for member in _union(hint) if member is not type(None)]
    return bool(members) and all(
        member in (str, bool, int, float) or typing.get_origin(member) is typing.Literal
        for member in members
    )


def _one_of(hint: Any) -> Any:
    """A value of a scalar hint: its first word, or a number."""
    choices, _ = _choices(hint)
    return choices[0] if choices else 1.0


def _takes_numbers(hint: Any) -> bool:
    return any(kind in (int, float) for kind in _kinds(hint))


def _takes_durations(hint: Any) -> bool:
    if hint in (None, Any, object) or any(member is Any for member in _union(hint)):
        return True
    return any(issubclass(kind, (dt.timedelta, np.timedelta64)) for kind in _kinds(hint))


def _numbers_only(hint: Any) -> bool:
    kinds = _kinds(hint)
    return bool(kinds) and all(kind in (int, float) for kind in kinds if kind is not type(None))


class Malformed(typing.NamedTuple):
    """A malformed value of an argument: whether it must be refused, and where
    within the argument it may be (``""`` at it; ``"[0]"`` at a list's
    element, or the argument for a list the length of which is wrong too);
    None anywhere within it, for a dict whose key or value may be blamed."""

    value: Any
    refused: bool
    within: tuple[str, ...] | None


def malformed(hint: Any, given: Any = None, *, table: bool = False) -> Iterator[Malformed]:
    """Malformed values of an argument of `hint`; of tables, for a `table`
    (from what it is `given`)."""
    if table:
        yield from _tables(given)
        return
    value = _invalid(hint)
    if value is not None:
        yield Malformed(value, True, ("",))
    if not _takes_none(hint):
        yield Malformed(None, True, ("",))
    if _numbers_only(hint):
        yield Malformed(True, True, ("",))
    if _takes_numbers(hint) and not _takes_durations(hint):
        # NumPy's durations are integers of their unit, which no count of anything is.
        yield Malformed(np.timedelta64(5, "s"), True, ("",))
        yield Malformed(np.timedelta64(5, "ns"), True, ("",))
    if not _takes_lists(hint):
        # Values where one value, or one object, goes: lists, arrays, Series, iterators.
        yield Malformed([1, 2], True, ("",))
        yield Malformed(np.array([1, 2]), True, ("",))
        yield Malformed(pd.Series([1, 2]), True, ("",))
        yield Malformed(iter([1, 2]), True, ("",))
        if _scalars_only(hint):
            yield Malformed(np.array([[1, 2], [3, 4]]), True, ("",))
    elif _takes_sequences_alone(hint):
        # Iterators, which checking would use up, where lists go.
        yield Malformed(iter(given if isinstance(given, list) else [1]), True, ("",))
    if not _takes_arrays(hint):
        yield Malformed(np.array(object(), dtype=object), True, ("",))
    if not _takes_dicts(hint):
        yield Malformed({"__invalid__": 1}, True, ("",))
    if isinstance(given, list) and given:
        # A list of a valid length missing its last item: None, or pandas' NA
        # (which has no truth), in a list and in a Series.
        last = ("", f"[{len(given) - 1}]")
        yield Malformed([*given[:-1], None], False, last)
        yield Malformed([*given[:-1], pd.NA], False, last)
        yield Malformed(pd.Series([*given[:-1], pd.NA], dtype=object), False, last)
    for member in _union(hint):
        if _fixed(member):
            # A NumPy duration in each place of a tuple of numbers, the others valid.
            places = typing.get_args(member)
            for i, place in enumerate(places):
                if _takes_numbers(place) and not _takes_durations(place):
                    for unit in ("s", "ns"):
                        filled = [_one_of(other) for other in places]
                        filled[i] = np.timedelta64(5, unit)
                        yield Malformed(tuple(filled), True, None)
    for kind in _union(hint):
        if typing.is_typeddict(kind):
            # Each key of a dict of settings with no value, or with several.
            for key in typing.get_type_hints(kind):
                yield Malformed({key: pd.NA}, False, None)
                yield Malformed({key: np.array([1, 2])}, False, None)
    for shape in _shapes(hint):
        within = (
            None
            if isinstance(shape, Mapping)
            else ("", "[0]")
            if isinstance(shape, list)
            else ("",)
        )
        yield Malformed(shape, False, within)


def _tables(given: Any) -> Iterator[Malformed]:
    """A table of no kind, at the data; and of what a call is given (a dict
    of columns), one whose columns differ in length, and one of objects,
    refused, if at all, at an option reading a column (``within`` "*")."""
    yield Malformed(5, True, ("",))
    if isinstance(given, Mapping) and all(isinstance(key, str) for key in given):
        columns = {key: list(value) for key, value in given.items() if isinstance(value, list)}
        if columns:
            first = next(iter(columns))
            yield Malformed({**columns, first: columns[first][:1]}, False, ("*",))
            yield Malformed(
                {key: [object()] * len(value) for key, value in columns.items()}, False, ("*",)
            )


class Argument(typing.NamedTuple):
    name: str
    hint: Any
    # Whether it is one of the keywords a `**options: Unpack[...]` takes.
    unpacked: bool


def arguments(function: Any) -> Iterator[Argument]:
    """The arguments of ``function`` a caller names, with keywords of the
    options it unpacks."""
    # Names a module imports only for type checking are herceg's own.
    names = {**vars(hg), **vars(sys.modules[function.__module__])}
    hints = typing.get_type_hints(function, globalns=names)
    for name, parameter in inspect.signature(function).parameters.items():
        if parameter.kind is parameter.VAR_POSITIONAL or name in TAKES_ANYTHING:
            continue
        hint = hints.get(name)
        if parameter.kind is parameter.VAR_KEYWORD:
            if typing.get_origin(hint) is Unpack:
                (options,) = typing.get_args(hint)
                for key, value in typing.get_type_hints(options).items():
                    yield Argument(key, value, True)
            continue
        yield Argument(name, hint, False)


def said(error: Any) -> str:
    return f"{error!r} at {getattr(error, 'path', None)}"


def misplaced(error: hg.ChartError | str, at: str, case: Malformed) -> bool:
    """Whether ``error`` is no ChartError where `case` says, within the
    argument at ``at``; an accepted value is misplaced only where it must be
    refused. A value that must be refused is refused as an invalid option."""
    if error == "accepted":
        return case.refused
    if not isinstance(error, hg.ChartError):
        return True
    if case.refused and error.code != "invalid-option":
        return True
    if error.path is None:
        return True
    if case.within == ("*",):
        # Within what holds the argument: a mark's options, at the option reading a column.
        holder = at.rpartition(".")[0]
        return bool(holder) and not error.path.startswith(f"{holder}.")
    if case.within is None:
        return not (error.path == at or str(error.path).startswith((f"{at}.", f"{at}[")))
    return error.path not in [at + within for within in case.within]


def refusal(make: Any, *args: Any, **options: Any) -> hg.ChartError | str:
    """What ``make(*args, **options)`` refuses, as a chart it makes is drawn."""
    try:
        made = make(*args, **options)
        if isinstance(made, hg.Panel) and made._chart is not None:
            made = made._chart  # a panel of a layout: what its chart draws
        if isinstance(made, hg.Chart):
            made.to_svg()
    except hg.ChartError as error:
        return error
    except Exception as error:  # noqa: BLE001 - what is not a ChartError is reported
        return f"{type(error).__name__}: {error}"
    return "accepted"


def twins(value: Any) -> list[Any]:
    """NumPy's forms of a valid Python value, which must be taken alike."""
    if isinstance(value, bool):
        return [np.bool_(value)]
    if isinstance(value, int):
        return [np.int64(value)]
    if isinstance(value, float):
        return [np.float64(value)]
    if isinstance(value, str):
        return [np.str_(value)]
    if isinstance(value, (list, tuple)) and value:
        if all(isinstance(item, str) for item in value) or all(
            isinstance(item, (int, float)) and not isinstance(item, bool) for item in value
        ):
            # A Series is read by position, whatever its index.
            return [np.array(value), pd.Series(value, index=range(10, 10 + len(value)))]
    return []
