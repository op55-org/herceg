"""Herceg charts in Flask apps: ``herceg.flask.init_app(app)``.

It serves herceg's script (``herceg.web.manifest()``) under ``url_prefix``,
each file cached for good since its name changes with its content, and
gives templates two globals::

    {{ herceg_assets(nonce=csp_nonce) }}   {# once per page #}
    {{ herceg_chart(chart, id="latency", data_url=url_for("latency_data")) }}

``herceg_chart`` takes ``herceg.web.fragment``'s options. Routes of chart
data are the application's own: return ``herceg.web.payload(chart)`` as
``application/octet-stream``, with the caching and authentication the data
needs. Needs the ``flask`` extra (``pip install 'herceg[flask]'``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

try:
    from flask import Blueprint, Flask, Response, abort, send_file, url_for
except ImportError as error:  # pragma: no cover - depends on the environment
    raise ImportError("herceg.flask needs Flask: pip install 'herceg[flask]'") from error

from . import web
from ._errors import ChartError, shown

if TYPE_CHECKING:
    from ._chart import Chart

__all__ = ["init_app"]

#: A year, never revalidated: a file of another content has another name.
_IMMUTABLE = "public, max-age=31536000, immutable"


def init_app(app: Flask, *, url_prefix: str = "/_herceg") -> None:
    """Serves herceg's web assets under ``url_prefix`` (a blueprint named
    ``"herceg"``) and adds the template globals ``herceg_assets`` and
    ``herceg_chart``."""
    if not isinstance(app, Flask):
        raise ChartError(f"init_app app: expected a Flask app; received {shown(app)}", path="app")
    if not isinstance(url_prefix, str) or not url_prefix.startswith("/"):
        raise ChartError(
            'init_app url_prefix: expected a path from the site\'s root ("/_herceg"); '
            f"received {shown(url_prefix)}",
            path="url_prefix",
        )
    blueprint = Blueprint("herceg", __name__, url_prefix=url_prefix)

    @blueprint.get("/<path:name>")
    def asset(name: str) -> Response:
        try:
            path = web.asset_path(name)
        except FileNotFoundError:
            abort(404)
        response = send_file(path, mimetype="text/javascript")
        response.headers["Cache-Control"] = _IMMUTABLE
        return response

    app.register_blueprint(blueprint)

    def herceg_assets(*, nonce: str | None = None) -> str:
        """The tags that load herceg's script, once per page."""
        # The assets are the entry's neighbors, wherever the app is mounted.
        entry = url_for("herceg.asset", name=web.manifest().entry)
        return web.assets(entry.rsplit("/", 1)[0], nonce=nonce)

    def herceg_chart(
        chart: Chart,
        *,
        id: str | None = None,
        nonce: str | None = None,
        data_url: str | None = None,
    ) -> str:
        """A chart for a page with ``herceg_assets()`` (see ``herceg.web.fragment``)."""
        return web.fragment(chart, id=id, nonce=nonce, data_url=data_url)

    app.jinja_env.globals.update(herceg_assets=herceg_assets, herceg_chart=herceg_chart)
