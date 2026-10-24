import { describe, expect, it } from "vitest";
import { ChartError } from "../../src/spec/errors.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { loadPayload } from "../../src/web/load.ts";
import { decodePayload, encodePayload, readInline } from "../../src/web/payload.ts";

const spec: ChartSpec = {
  data: { d: { columns: { x: { type: "number", dtype: "float64", buffer: 0 } } } },
  marks: [{ type: "line", x: "x", y: "x", data: "d" }],
};

/** A payload whose header is `header` as given, followed by `tail` bytes. */
function raw(header: string, tail = 0): Uint8Array {
  const text = new TextEncoder().encode(header);
  const start = Math.ceil((4 + text.length) / 8) * 8;
  const out = new Uint8Array(start + tail);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  return out;
}

function refusal(make: () => unknown): ChartError {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(ChartError);
    expect(error).toMatchObject({ code: "load-failed", phase: "load" });
    return error as ChartError;
  }
  throw new Error("expected a refusal");
}

describe("chart payloads", () => {
  it("carry the spec and its buffers, each at a multiple of 8 bytes", () => {
    const first = new Float64Array([1, 2, 3]);
    const second = new Uint8Array([7, 8, 9]);
    const third = new Int32Array([4]);
    const bytes = encodePayload(spec, [first, second, third], { epoch: "e1" });
    const { header, buffers } = decodePayload(bytes);
    expect(header).toMatchObject({ protocol: 1, kind: "chart", spec, epoch: "e1" });
    expect(header.buffers).toEqual([
      [0, 24],
      [24, 3],
      [32, 4],
    ]);
    expect(new Float64Array(buffers[0]!.buffer, buffers[0]!.byteOffset, 3)).toEqual(first);
    expect([...buffers[1]!]).toEqual([7, 8, 9]);
    for (const buffer of buffers) expect(buffer.byteOffset % 8).toBe(0);
    // A maker's own fields cannot replace the envelope's.
    const replaced = decodePayload(encodePayload(spec, [], { protocol: 9, kind: "grid" }));
    expect(replaced.header).toMatchObject({ protocol: 1, kind: "chart" });
  });

  it("are read from views at any offset, copied once to align them", () => {
    const bytes = encodePayload(spec, [new Float64Array([5])]);
    const holder = new Uint8Array(bytes.length + 3);
    holder.set(bytes, 3);
    const { buffers, bytes: read } = decodePayload(holder.subarray(3));
    expect(read.byteOffset % 8).toBe(0);
    expect(new Float64Array(buffers[0]!.buffer, buffers[0]!.byteOffset, 1)[0]).toBe(5);
    expect(decodePayload(bytes.buffer).header.spec).toEqual(spec);
  });

  it("refuse what is not one, saying where", () => {
    expect(refusal(() => decodePayload(new Uint8Array(2))).message).toBe(
      "payload: expected at least 4 bytes; received 2; make payloads with herceg.web.payload(chart) or encodePayload",
    );
    expect(refusal(() => decodePayload(new Uint8Array([200, 0, 0, 0, 1]))).message).toMatch(
      /^payload: its header length \(200 bytes\) does not fit in the payload \(5 bytes\)/,
    );
    expect(refusal(() => decodePayload(raw("{not json"))).message).toMatch(
      /^payload: its header is not UTF-8 JSON; /,
    );
    expect(refusal(() => decodePayload(raw("[1]"))).message).toMatch(
      /^payload: its header is not a JSON object/,
    );
    const header = (fields: object) => JSON.stringify({ kind: "chart", spec, ...fields });
    expect(refusal(() => decodePayload(raw(header({ buffers: [] })))).message).toMatch(
      /^payload\.protocol: missing; expected 1/,
    );
    expect(refusal(() => decodePayload(raw(header({ protocol: 2, buffers: [] })))).message).toMatch(
      /^payload\.protocol: unsupported version 2; expected 1/,
    );
    expect(
      refusal(() => decodePayload(raw(header({ protocol: 1, kind: "grid", buffers: [] })))).message,
    ).toMatch(/^payload\.kind: unsupported kind "grid"; expected "chart"/);
    expect(
      refusal(() => decodePayload(raw(JSON.stringify({ protocol: 1, kind: "chart", spec: [] }))))
        .message,
    ).toMatch(/^payload\.spec: expected a chart spec object/);
    expect(
      refusal(() =>
        decodePayload(
          raw(
            header({
              protocol: 1,
              buffers: [
                [0, 8],
                [8, -1],
              ],
            }),
            16,
          ),
        ),
      ).message,
    ).toMatch(/^payload\.buffers\[1\]: expected \[offset, length\] in bytes; received \[8,-1\]/);
    expect(
      refusal(() => decodePayload(raw(header({ protocol: 1, buffers: [[3, 1]] }), 8))).message,
    ).toMatch(/^payload\.buffers\[0\]: offset 3 is not a multiple of 8/);
    expect(
      refusal(() =>
        decodePayload(
          raw(
            header({
              protocol: 1,
              buffers: [
                [0, 8],
                [8, 9],
              ],
            }),
            16,
          ),
        ),
      ).message,
    ).toMatch(/^payload\.buffers\[1\]: byte range exceeds the payload length; /);
  });

  it("say when a route answered with a page or JSON instead", () => {
    const page = new TextEncoder().encode("<!doctype html><html><body>Sign in</body></html>");
    expect(refusal(() => decodePayload(page)).message).toBe(
      'payload: the response is not a Herceg payload (it starts with "<!doctype"); return herceg.web.payload(chart) from the data_url route',
    );
    const json = new TextEncoder().encode('{"error": "not found"}');
    expect(refusal(() => decodePayload(json)).message).toMatch(/starts with '\{"error":'\)/);
  });

  it("are read as JSON with base64 buffers, as page fragments carry them", () => {
    const encoded = btoa(String.fromCharCode(...new Uint8Array(new Float64Array([1.5]).buffer)));
    const read = readInline(
      JSON.stringify({ protocol: 1, kind: "chart", spec, buffers: [encoded] }),
    );
    expect(read.spec).toEqual(spec);
    expect(new Float64Array(read.buffers[0]!.buffer)[0]).toBe(1.5);
    expect(refusal(() => readInline("<p>")).message).toMatch(
      /^payload: the fragment's payload is not JSON/,
    );
    expect(
      refusal(() =>
        readInline(JSON.stringify({ protocol: 1, kind: "chart", spec, buffers: ["%%"] })),
      ).message,
    ).toMatch(/^payload\.buffers\[0\]: expected a base64 string/);
  });

  it("load into chart options, unless their signal aborted", async () => {
    const bytes = encodePayload({ data: { d: { columns: { x: [1, 2] } } }, marks: [] });
    expect((await loadPayload(bytes)).marks).toEqual([]);
    const controller = new AbortController();
    const reason = new Error("the page went elsewhere");
    controller.abort(reason);
    await expect(loadPayload(bytes, { signal: controller.signal })).rejects.toBe(reason);
  });
});
