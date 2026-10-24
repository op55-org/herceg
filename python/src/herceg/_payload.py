"""A chart as one binary payload, as web pages fetch it and Streamlit sends it.

A little-endian uint32 header length, the UTF-8 JSON header, padding to a
multiple of 8 bytes, then the buffers the spec's columns reference, each at
an offset that is a multiple of 8 from the first, so the browser views them
as typed arrays without copying. The header is an envelope with its own
version: ``{"protocol": 1, "kind": "chart", "spec": ..., "buffers": [[offset,
length], ...]}``, plus what its maker adds (Streamlit's events and epochs).
Page fragments carry the same envelope as JSON, buffers in base64
(``inline``). herceg's JavaScript reads both (``herceg/web``'s payload.ts).
"""

from __future__ import annotations

import base64
import json
import struct
from typing import Any

PROTOCOL = 1


def encode(spec: dict[str, Any], buffers: list[bytes], **extra: Any) -> bytes:
    """The payload of a spec and its buffers, with ``extra`` header fields."""
    offsets = []
    end = 0
    for buffer in buffers:
        offsets.append([end, len(buffer)])
        end = _aligned(end + len(buffer))
    header = json.dumps(
        {**extra, "protocol": PROTOCOL, "kind": "chart", "spec": spec, "buffers": offsets},
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    start = _aligned(4 + len(header))
    out = bytearray(start + end)
    struct.pack_into("<I", out, 0, len(header))
    out[4 : 4 + len(header)] = header
    for (offset, length), buffer in zip(offsets, buffers, strict=True):
        out[start + offset : start + offset + length] = buffer
    return bytes(out)


def inline(spec: dict[str, Any], buffers: list[bytes]) -> dict[str, Any]:
    """The payload as JSON, as a page fragment carries it: buffers in base64."""
    return {
        "protocol": PROTOCOL,
        "kind": "chart",
        "spec": spec,
        "buffers": [base64.b64encode(buffer).decode("ascii") for buffer in buffers],
    }


def _aligned(size: int) -> int:
    return -(-size // 8) * 8
