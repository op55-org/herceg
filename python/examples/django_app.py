"""Herceg charts in a Django app, through ``herceg.web``: one file, no project.

    pip install herceg django
    python python/examples/django_app.py runserver

A view serves herceg's script; with ``django.contrib.staticfiles``, list
``web.manifest().directory`` in ``STATICFILES_DIRS`` instead (under a prefix,
``("herceg", web.manifest().directory)``) and give ``web.assets`` the static
URL. Collect the files as they are: their names and the imports between them
carry their hashes, which a storage must not rewrite. Fragments mark
themselves safe, so templates insert them without ``|safe``.
"""

import sys

import numpy as np
from django.conf import settings
from django.core.management import execute_from_command_line
from django.http import FileResponse, Http404, HttpResponse
from django.template import Context, Engine
from django.urls import path, reverse

import herceg as hg
from herceg import web

settings.configure(DEBUG=True, ROOT_URLCONF=__name__, SECRET_KEY="example", ALLOWED_HOSTS=["*"])

PAGE = Engine().from_string("""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Latency</title>{{ assets }}</head>
<body>
{{ latency }}
{{ requests }}
</body>
</html>""")


def latency_chart() -> hg.Chart:
    rng = np.random.default_rng(7)
    time = np.arange("2026-01-01", "2026-01-02", dtype="datetime64[m]")
    p50 = 40 + 15 * np.sin(np.linspace(0, 2 * np.pi, len(time))) + rng.normal(0, 3, len(time))
    return hg.line(
        {"time": time, "p50": p50, "p99": p50 * 2.5 + rng.gamma(2, 8, len(time))},
        x="time",
        y=["p50", "p99"],
        title="Latency by minute",
        sync="ops",
        time_zone="UTC",
    )


def page(request):
    # The assets are the entry's neighbors, wherever the app is mounted.
    base = reverse("herceg-asset", args=[web.manifest().entry]).rsplit("/", 1)[0]
    context = {
        "assets": web.assets(base),
        "latency": web.fragment(latency_chart(), id="latency"),
        # This chart's data comes from a route instead of the page.
        "requests": web.fragment(latency_chart(), id="requests", data_url=reverse("requests")),
    }
    return HttpResponse(PAGE.render(Context(context)))


def asset(request, name):
    try:
        file = web.asset_path(name)
    except FileNotFoundError:
        raise Http404(name) from None
    response = FileResponse(file.open("rb"), content_type="text/javascript")
    # A file of other content has another name: cache each for good.
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def requests_data(request):
    # The app decides how chart data is cached and who may read it.
    return HttpResponse(web.payload(latency_chart()), content_type="application/octet-stream")


urlpatterns = [
    path("", page),
    path("herceg/<str:name>", asset, name="herceg-asset"),
    path("requests.bin", requests_data, name="requests"),
]

if __name__ == "__main__":
    execute_from_command_line(sys.argv)
