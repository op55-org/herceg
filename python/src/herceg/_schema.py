"""The JSON Schema of the portable spec, for products that build chart editors."""

from __future__ import annotations

import json
from typing import Any

from ._render import asset


def spec_schema() -> dict[str, Any]:
    """The JSON Schema (draft 2020-12) of the spec ``Chart.to_spec()`` writes
    and the engine reads: every option's type, enumeration, numeric range,
    default where it has one, and description, the same file the npm
    package publishes as ``herceg/spec.schema.json``. Its description lists
    what herceg also checks that the schema cannot say, such as fields
    naming columns of their table. Each call returns a new dict."""
    schema: dict[str, Any] = json.loads(asset("spec.schema.json"))
    return schema
