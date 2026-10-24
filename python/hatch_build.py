"""Refuses to build a package without herceg's JavaScript bundles.

The bundles are build outputs (`npm run build:python`), not tracked by git;
a package built without them would install but fail to render.
"""

import json
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

BUNDLES = ("herceg.js", "herceg-static.js", "herceg-widget.js", "herceg-streamlit.js")


class BundleCheck(BuildHookInterface):
    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict) -> None:
        static = Path(self.root) / "src" / "herceg" / "static"
        missing = [name for name in BUNDLES if not (static / name).is_file()]
        # The web assets: their manifest and every file it lists.
        manifest = static / "web" / "manifest.json"
        if manifest.is_file():
            listed = json.loads(manifest.read_text(encoding="utf-8"))["files"]
            missing += [f"web/{name}" for name in listed if not (static / "web" / name).is_file()]
        else:
            missing.append("web/manifest.json")
        if missing:
            raise RuntimeError(
                f"Missing {', '.join(missing)} in {static}. Run `npm run build:python` "
                "from the repository root before building the Python package."
            )
