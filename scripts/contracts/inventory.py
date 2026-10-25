"""What the Python package offers, as JSON for scripts/contracts/inventory.mjs:
the public methods of ``herceg.Chart`` and ``herceg.Panel``, the functions
``herceg`` and ``herceg.express`` export, and the classes they export; and
for the API audit (scripts/contracts/api.mjs), the keywords each of them
takes, with the string choices their annotations allow, and the fields of
the option classes (dataclasses, TypedDicts) a keyword takes, at any depth.

Run from python/: ``uv run --extra dev python ../scripts/contracts/inventory.py``.
"""

import collections.abc
import dataclasses
import inspect
import json
import sys
import types
import typing
from collections.abc import Callable
from typing import Any

import seaborn

# What seaborn's kde_kws hold (a private module: uv.lock pins seaborn's version).
from seaborn._statistics import KDE

import herceg as hg
import herceg.express as hx
from herceg._layout import Cell
from herceg.widget import ChartWidget


def public_methods(cls: type) -> list[str]:
    return sorted(name for name, _ in inspect.getmembers(cls) if not name.startswith("_"))


def exported(module: object) -> tuple[list[str], list[str]]:
    names = module.__all__  # type: ignore[attr-defined]
    functions = [name for name in names if inspect.isfunction(getattr(module, name))]
    classes = [name for name in names if inspect.isclass(getattr(module, name))]
    return sorted(functions), sorted(classes)


#: The generic types whose arguments are the values they take: unions and
#: sequences, not mappings (whose ``str`` keys are not options' choices).
TAKES_ITS_ARGUMENTS = {typing.Union, types.UnionType, typing.Annotated, list, tuple, set, frozenset}


def choices(annotation: Any) -> list[str]:
    """The strings a ``Literal`` in ``annotation`` allows (through unions,
    sequences, and type aliases), with ``"*"`` where it takes any ``str``."""
    found: set[str] = set()

    def walk(part: Any) -> None:
        origin = typing.get_origin(part)
        if part is str:
            found.add("*")
        elif origin is typing.Literal:
            found.update(arg for arg in typing.get_args(part) if isinstance(arg, str))
        elif origin in TAKES_ITS_ARGUMENTS or origin is collections.abc.Sequence:
            for arg in typing.get_args(part):
                walk(arg)
        elif hasattr(part, "__value__"):
            walk(part.__value__)

    walk(annotation)
    return sorted(found)


#: Names annotations use that their modules import only for type checking.
CHECKING_ONLY = {**vars(hg), "ChartWidget": ChartWidget}


def hints_of(typed: Any) -> dict[str, Any]:
    # A module's own names come first: _guides.Channel, a Literal, is not hg.Channel.
    module = sys.modules.get(getattr(typed, "__module__", ""))
    own = vars(module) if module else {}
    return typing.get_type_hints(typed, localns={**CHECKING_ONLY, **own}, include_extras=True)


def keywords_of(typed: Any) -> dict[str, list[str]]:
    hints = hints_of(typed)
    return {name: choices(hint) for name, hint in hints.items()}


def options(function: Callable[..., Any]) -> dict[str, list[str]]:
    """The keywords ``function`` takes, each with its choices; ``**options:
    Unpack[HelperOptions]`` shows as ``**HelperOptions`` (whose keywords
    are listed apart), and a bare ``**options`` as ``**``: taking anything
    is not taking a named option."""
    hints = hints_of(function)
    taken: dict[str, list[str]] = {}
    for name, parameter in inspect.signature(function).parameters.items():
        if name == "self" or parameter.kind is parameter.VAR_POSITIONAL:
            continue
        if parameter.kind is parameter.VAR_KEYWORD:
            (unpacked,) = typing.get_args(hints.get(name)) or (None,)
            taken["**" + (unpacked.__name__ if typing.is_typeddict(unpacked) else "")] = []
            continue
        taken[name] = choices(hints.get(name, Any))
    return taken


def methods_options(cls: type) -> dict[str, dict[str, list[str]]]:
    return {
        name: options(member)
        for name, member in inspect.getmembers(cls, inspect.isfunction)
        if not name.startswith("_")
    }


#: The generic types whose arguments are alternatives: a keyword taking
#: ``AxisOptions | dict[str, Any] | None`` takes an ``AxisOptions``.
ALTERNATIVES = {typing.Union, types.UnionType, typing.Annotated}

#: The collections whose elements an option holds: ``guides: Sequence[Guide]``.
ELEMENTS = {list, tuple, set, frozenset, collections.abc.Sequence}

#: The mappings whose values an option holds: ``scales: Mapping[str, Scale]``.
MAPPINGS = {dict, collections.abc.Mapping}


def option_classes(annotation: Any) -> list[type]:
    """The option classes (dataclasses and TypedDicts) ``annotation``
    takes, through unions, type aliases, and the elements of collections
    and values of mappings it holds."""
    return held_classes(annotation)[0]


def held_classes(annotation: Any) -> tuple[list[type], bool]:
    """``option_classes``, and whether a mapping holds them by name."""
    found: list[type] = []
    keyed = False

    def walk(part: Any, by_name: bool) -> None:
        nonlocal keyed
        origin = typing.get_origin(part)
        if isinstance(part, type) and (dataclasses.is_dataclass(part) or typing.is_typeddict(part)):
            keyed = keyed or by_name
            if part not in found:
                found.append(part)
        elif origin in ALTERNATIVES or origin in ELEMENTS:
            for arg in typing.get_args(part):
                walk(arg, by_name)
        elif origin in MAPPINGS and len(typing.get_args(part)) == 2:
            walk(typing.get_args(part)[1], True)
        elif hasattr(part, "__value__"):
            walk(part.__value__, by_name)

    walk(annotation, False)
    return found, keyed


def fields_of(cls: type) -> dict[str, Any]:
    """An option class's fields (a TypedDict's keys), with their annotations."""
    hints = hints_of(cls)
    if typing.is_typeddict(cls):
        return hints
    return {field.name: hints[field.name] for field in dataclasses.fields(cls) if field.init}


def class_name(cls: type) -> str:
    """A class's name as users import it: hx.KdeOptions for Express's own, hg. otherwise."""
    express = cls.__module__.startswith("herceg.express")
    return f"{'hx' if express else 'hg'}.{cls.__qualname__}"


def settings_of(
    classes: list[type], within: tuple[str, ...] = (), keyed_by_name: bool = False
) -> dict[str, Any]:
    """The settings of option classes: each field's choices (those of every
    class that has it), the settings of the classes it takes, at any depth
    (a class met again inside itself, once), and the classes' names."""
    options: dict[str, set[str]] = {}
    held: dict[str, list[type]] = {}
    keyed: set[str] = set()
    for cls in classes:
        for name, hint in fields_of(cls).items():
            options.setdefault(name, set()).update(choices(hint))
            found, by_name = held_classes(hint)
            held.setdefault(name, []).extend(c for c in found if c not in held[name])
            if by_name:
                keyed.add(name)
    key = "|".join(sorted(cls.__qualname__ for cls in classes))
    nested = (
        {}
        if key in within
        else {
            name: settings_of(found, (*within, key), name in keyed)
            for name, found in held.items()
            if found
        }
    )
    return {
        "options": {name: sorted(found) for name, found in options.items()},
        "nested": nested,
        "type": "|".join(sorted(class_name(cls) for cls in classes)),
        **({"keyed": True} if keyed_by_name else {}),
    }


def nested(typed: Any) -> dict[str, dict[str, Any]]:
    """The settings of the option classes each keyword (or TypedDict key) of ``typed`` takes."""
    hints = hints_of(typed)
    held = {name: held_classes(hint) for name, hint in hints.items() if name != "return"}
    return {
        name: settings_of(classes, (), by_name)
        for name, (classes, by_name) in held.items()
        if classes
    }


def unpacked(function: Callable[..., Any]) -> Any:
    """The TypedDict a function's ``**options`` unpacks (``Unpack[HelperOptions]``), or None."""
    hints = hints_of(function)
    for name, parameter in inspect.signature(function).parameters.items():
        if parameter.kind is parameter.VAR_KEYWORD:
            (typed,) = typing.get_args(hints.get(name)) or (None,)
            if typing.is_typeddict(typed):
                return typed
    return None


def makes_chart(function: Callable[..., Any]) -> bool:
    """Whether a function makes a chart, taking its options: it returns one
    and takes none (``recompute`` remakes a chart from the chart given)."""
    hints = hints_of(function)
    taken = [hint for name, hint in hints.items() if name != "return"]
    return hints.get("return") is hg.Chart and hg.Chart not in taken


def parameters_of(function: Callable[..., Any]) -> list[str]:
    """A function's named parameters (``self`` apart)."""
    unnamed = {inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD}
    parameters = inspect.signature(function).parameters.values()
    return [p.name for p in parameters if p.name != "self" and p.kind not in unnamed]


def seaborn_keywords(name: str) -> list[str] | None:
    """The keywords seaborn's function of that name takes, or None for none:
    its parameters, and matplotlib's ``color``, which a function taking
    ``**kwargs`` passes to its artists."""
    function = getattr(seaborn, name, None)
    if function is None:
        return None
    keywords = parameters_of(function)
    kinds = [parameter.kind for parameter in inspect.signature(function).parameters.values()]
    if inspect.Parameter.VAR_KEYWORD in kinds and "color" not in keywords:
        keywords.append("color")
    return keywords


#: The keyword dicts of seaborn's that Express types as option classes: by
#: function and Express keyword, the seaborn class whose parameters they hold.
SEABORN_SETTINGS: dict[str, dict[str, Callable[..., Any]]] = {
    "histplot": {"kde_options": KDE.__init__},
}


def methods_nested(cls: type) -> dict[str, dict[str, dict[str, list[str]]]]:
    return {
        name: nested(member)
        for name, member in inspect.getmembers(cls, inspect.isfunction)
        if not name.startswith("_")
    }


helpers, classes = exported(hg)
express, express_classes = exported(hx)
# What each function making a chart unpacks as the chart's options, by name.
unpacking = {
    "helpers": {
        name: unpacked(getattr(hg, name)) for name in helpers if makes_chart(getattr(hg, name))
    },
    "express": {
        name: unpacked(getattr(hx, name)) for name in express if makes_chart(getattr(hx, name))
    },
}
unpacked_types = {
    typed for functions in unpacking.values() for typed in functions.values() if typed
}
print(
    json.dumps(
        {
            "chart": public_methods(hg.Chart),
            "panel": public_methods(hg.Panel),
            "helpers": helpers,
            "classes": classes,
            "express": express,
            "expressClasses": express_classes,
            "options": {
                "chart": options(hg.Chart.__init__),
                "update": keywords_of(hg.ChartUpdate),
                "helper": keywords_of(hg.HelperOptions),
                "methods": methods_options(hg.Chart),
                "panelMethods": methods_options(hg.Panel),
                "helpers": {name: options(getattr(hg, name)) for name in helpers},
                "express": {name: options(getattr(hx, name)) for name in express},
                "panel": options(Cell.panel),
                "panelClass": options(hg.Panel.__init__),
                "inset": options(hg.Panel.inset),
                "unpacked": {
                    surface: {name: typed and typed.__name__ for name, typed in functions.items()}
                    for surface, functions in unpacking.items()
                },
                # Seaborn's keywords for each Express function making a chart, and
                # those of its keyword dicts Express types (SEABORN_SETTINGS).
                "seaborn": {
                    "keywords": {name: seaborn_keywords(name) for name in unpacking["express"]},
                    "settings": {
                        name: {keyword: parameters_of(of) for keyword, of in held.items()}
                        for name, held in SEABORN_SETTINGS.items()
                    },
                },
                "unpackedTypes": {
                    typed.__name__: {"keywords": keywords_of(typed), "nested": nested(typed)}
                    for typed in unpacked_types
                },
                # The widget's own listeners and members, not those of the ipywidget it is.
                "events": sorted(name for name in vars(ChartWidget) if name.startswith("on_")),
                "widget": sorted(
                    name for name in vars(ChartWidget) if not name.startswith(("_", "on_"))
                ),
                "nested": {
                    "chart": nested(hg.Chart.__init__),
                    "update": nested(hg.ChartUpdate),
                    "helper": nested(hg.HelperOptions),
                    "methods": methods_nested(hg.Chart),
                    "panelMethods": methods_nested(hg.Panel),
                    "helpers": {name: nested(getattr(hg, name)) for name in helpers},
                    "express": {name: nested(getattr(hx, name)) for name in express},
                    "panel": nested(Cell.panel),
                    "panelClass": nested(hg.Panel.__init__),
                    "inset": nested(hg.Panel.inset),
                },
            },
        }
    )
)
