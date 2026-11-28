"""Chart's mark methods, by family: each module holds the methods of one
family of marks, which ``Chart``'s body binds (``line = _marks.series.line``),
and what only those marks use. ``common`` holds what several families share."""

from . import annotations, distributions, layouts, maps, matrices, networks, series, three_d

#: The families, in the order Chart binds their methods.
FAMILIES = (series, distributions, matrices, annotations, layouts, networks, maps, three_d)
