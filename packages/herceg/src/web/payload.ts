// A chart as one binary payload, the form web pages fetch from a server and
// Streamlit hands its component: a little-endian uint32 header length, the
// UTF-8 JSON header, padding to a multiple of 8 bytes, then the buffers the
// spec's columns reference, each at an offset that is a multiple of 8 from
// the first, so typed arrays view them in place.
//
// The header is an envelope with its own version (`protocol`), apart from
// the spec's: `{ protocol: 1, kind: "chart", spec, buffers }`, plus what
// the maker adds for itself (Streamlit's events and epochs). Fragments of a
// page carry the same envelope as JSON, with base64 buffers (`readInline`).
// Everything is checked before any typed array views the bytes.

import { ChartError } from "../spec/errors.ts";
import type { SpecBuffer } from "../spec/load.ts";
import type { ChartSpec } from "../spec/spec.ts";

/** The payload format version this herceg writes and reads. */
export const PAYLOAD_PROTOCOL = 1;

/** A payload's header: the chart's spec and where its buffers are. */
export interface PayloadHeader {
  readonly protocol: typeof PAYLOAD_PROTOCOL;
  readonly kind: "chart";
  readonly spec: ChartSpec;
  /** Each buffer's byte offset from the first buffer's, and its length. */
  readonly buffers: readonly (readonly [offset: number, length: number])[];
  /** What the payload's maker added for itself, such as Streamlit's events. */
  readonly [extra: string]: unknown;
}

/** A payload read: its header, and its buffers viewing `bytes`. */
export interface DecodedPayload {
  readonly header: PayloadHeader;
  readonly buffers: Uint8Array[];
  /** The payload's bytes, copied once if they did not start at a multiple of 8. */
  readonly bytes: Uint8Array;
}

const ALIGN = 8;
const aligned = (size: number) => Math.ceil(size / ALIGN) * ALIGN;

/**
 * The payload of a spec and its buffers, with `extra` header fields (which
 * may not replace the envelope's).
 */
export function encodePayload(
  spec: ChartSpec,
  buffers: readonly SpecBuffer[] = [],
  extra: Readonly<Record<string, unknown>> = {},
): Uint8Array<ArrayBuffer> {
  const views = buffers.map((buffer) =>
    ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer),
  );
  const offsets: [number, number][] = [];
  let end = 0;
  for (const view of views) {
    offsets.push([end, view.byteLength]);
    end = aligned(end + view.byteLength);
  }
  const header = new TextEncoder().encode(
    JSON.stringify({ ...extra, protocol: PAYLOAD_PROTOCOL, kind: "chart", spec, buffers: offsets }),
  );
  const start = aligned(4 + header.length);
  const out = new Uint8Array(start + end);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  for (const [i, view] of views.entries()) out.set(view, start + offsets[i]![0]);
  return out;
}

/** Reads a payload, refusing bytes that are not one with a ChartError. */
export function decodePayload(data: ArrayBuffer | ArrayBufferView): DecodedPayload {
  let bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  // A view into a larger message (as Streamlit hands one over) may start
  // anywhere; one copy aligns it.
  if (bytes.byteOffset % ALIGN !== 0) bytes = bytes.slice();
  if (bytes.length < 4)
    throw refused("payload", `expected at least 4 bytes; received ${bytes.length}`, bytes);
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (length === 0 || 4 + length > bytes.length)
    throw refused(
      "payload",
      `its header length (${length} bytes) does not fit in the payload (${bytes.length} bytes)`,
      bytes,
    );
  let text: string;
  let header: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + length));
    header = JSON.parse(text);
  } catch {
    throw refused("payload", "its header is not UTF-8 JSON", bytes);
  }
  const envelope = checkEnvelope(header);
  const start = aligned(4 + length);
  const ranges = envelope.buffers;
  if (!Array.isArray(ranges))
    throw refused("payload.buffers", "expected a list of [offset, length] pairs");
  const buffers = ranges.map((range: unknown, i) => {
    const at = `payload.buffers[${i}]`;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((value) => Number.isSafeInteger(value) && value >= 0)
    )
      throw refused(at, `expected [offset, length] in bytes; received ${shown(range)}`);
    const [offset, size] = range as [number, number];
    if (offset % ALIGN !== 0)
      throw refused(
        at,
        `offset ${offset} is not a multiple of ${ALIGN}, so typed arrays cannot view it`,
      );
    if (start + offset + size > bytes.length)
      throw refused(at, "byte range exceeds the payload length");
    return bytes.subarray(start + offset, start + offset + size);
  });
  return { header: envelope as PayloadHeader, buffers, bytes };
}

/**
 * Reads a payload as JSON, as fragments of a page carry one: the header's
 * envelope, with each buffer as a base64 string in place of its byte range.
 */
export function readInline(json: string): { spec: ChartSpec; buffers: Uint8Array[] } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw refused(
      "payload",
      "the fragment's payload is not JSON; make the fragment with herceg.web.fragment(chart)",
    );
  }
  const envelope = checkEnvelope(value);
  if (!Array.isArray(envelope.buffers))
    throw refused("payload.buffers", "expected a list of base64 strings");
  const buffers = envelope.buffers.map((buffer: unknown, i) => {
    const decoded = typeof buffer === "string" ? fromBase64(buffer) : undefined;
    if (!decoded) throw refused(`payload.buffers[${i}]`, "expected a base64 string");
    return decoded;
  });
  return { spec: envelope.spec as ChartSpec, buffers };
}

/** The envelope's own fields checked: the protocol, the kind, and a spec. */
function checkEnvelope(
  value: unknown,
): Record<string, unknown> & { buffers: unknown; spec: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw refused("payload", "its header is not a JSON object");
  const header = value as Record<string, unknown> & { buffers: unknown; spec: unknown };
  if (header.protocol !== PAYLOAD_PROTOCOL)
    throw refused(
      "payload.protocol",
      header.protocol === undefined
        ? `missing; expected ${PAYLOAD_PROTOCOL}, as herceg.web.payload(chart) writes`
        : `unsupported version ${shown(header.protocol)}; expected ${PAYLOAD_PROTOCOL}`,
    );
  if (header.kind !== "chart")
    throw refused(
      "payload.kind",
      `unsupported kind ${shown(header.kind)}; expected "chart" (payloads carry charts, not grids)`,
    );
  if (typeof header.spec !== "object" || header.spec === null || Array.isArray(header.spec))
    throw refused("payload.spec", "expected a chart spec object");
  return header;
}

/**
 * A payload refused at `location`. Bytes that start like a page or JSON
 * were not made by herceg: most likely a route answered with something else.
 */
function refused(location: string, problem: string, bytes?: Uint8Array): ChartError {
  const start = bytes
    ? new TextDecoder().decode(bytes.subarray(0, 16)).trimStart().slice(0, 9)
    : "";
  const quote = start.includes('"') ? "'" : '"';
  const message = /^[<{[]/.test(start)
    ? `${location}: the response is not a Herceg payload (it starts with ${quote}${start}${quote}); return herceg.web.payload(chart) from the data_url route`
    : `${location}: ${problem}; make payloads with herceg.web.payload(chart) or encodePayload`;
  return new ChartError({ code: "load-failed", phase: "load", message });
}

function shown(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

/** Bytes of base64 text, or undefined for text that is not base64. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
