import { describe, expect, it } from "vitest";
import { type Drawn, readoutText } from "./adapter.ts";
import { type HoverTarget, hovered, numbersIn, writes, writesFor } from "./expect.ts";
import { dataBytes } from "./harness.ts";

describe("readouts", () => {
  it("reads numbers with their decimals, grouping, and either minus sign", () => {
    expect(numbersIn("1,234.5 and −0.25, 7")).toEqual([
      { value: 1234.5, decimals: 1 },
      { value: -0.25, decimals: 2 },
      { value: 7, decimals: 0 },
    ]);
  });

  it("takes a value as written to the decimals shown, and no further", () => {
    expect(writes("latency 108.44 ms", 108.43789)).toBe(true);
    expect(writes("latency 108.4 ms", 108.43789)).toBe(true);
    expect(writes("latency 108.4 ms", 108.46)).toBe(false);
    expect(writes("108", 108.6)).toBe(false);
  });

  it("takes a series' value only right after its name", () => {
    const text = "00:04:10 series 1 108.44 series 2 114.79 series 10 208.6";
    expect(writesFor({ text }, "series 1", 108.43789)).toBe(true);
    // Another series' value, "series 10"'s, and the time before it are not series 1's.
    expect(writesFor({ text }, "series 1", 114.79)).toBe(false);
    expect(writesFor({ text }, "series 1", 208.6)).toBe(false);
    expect(writesFor({ text }, "series 1", 10)).toBe(false);
    // A readout that names other series but not this one writes nothing for it.
    expect(writesFor({ text: "series 2 108.44" }, "series 1", 108.43789)).toBe(false);
    // Nor does one that names no series, unless the adapter told the value apart.
    expect(writesFor({ text: "108.44" }, "series 1", 108.43789)).toBe(false);
    expect(writesFor({ text: "t 12:00 108.44 114.79", value: "114.79" }, "series 1", 114.79)).toBe(
      true,
    );
    expect(writesFor({ text: "t 12:00 108.44 114.79", value: "114.79" }, "series 1", 108.44)).toBe(
      false,
    );
    // A name inside another word is not the name.
    expect(writesFor({ text: "data 50.1 a 40.2" }, "a", 50.1)).toBe(false);
    expect(writesFor({ text: "data 50.1 a 40.2" }, "a", 40.2)).toBe(true);
    // Only the number right after the name, with spaces or a colon between.
    expect(writesFor({ text: "series 1 — series 2 108.44" }, "series 1", 2)).toBe(false);
    expect(writesFor({ text: "series 1 — series 2 108.44" }, "series 1", 108.44)).toBe(false);
    expect(writesFor({ text: "series 1: 108.44" }, "series 1", 108.44)).toBe(true);
    // A value told apart must be that number alone.
    expect(writesFor({ text: "—", value: "—" }, "series 1", 0)).toBe(false);
    expect(writesFor({ text: "y 108.44", value: "series 2 108.44" }, "series 1", 2)).toBe(false);
  });

  it("takes a point's y as the readout's last number", () => {
    const drawn: Drawn = {
      draws: 1,
      width: 100,
      height: 100,
      plot: { left: 0, top: 0, width: 100, height: 100 },
      x: [0, 100],
      y: [0, 100],
      readout: { text: "40.0" },
    };
    // The point (40, 30), under the pointer.
    const target: HoverTarget = {
      pointer: { x: 40, y: 70 },
      kind: "scatter",
      data: { x: Float64Array.of(40), y: Float64Array.of(30) },
    };
    expect(hovered(drawn, target)).toMatch(/writes none/);
    expect(hovered({ ...drawn, readout: { text: "(40.0, 30.0)" } }, target)).toBeUndefined();
    expect(hovered({ ...drawn, readout: { text: "30.0" } }, target)).toBeUndefined();
    // A name's digit is not the y: the readout's last number is.
    expect(hovered({ ...drawn, readout: { text: "trace 30 (40, 999)" } }, target)).toMatch(
      /writes none/,
    );
  });

  it("keeps a readout's text nodes apart, so a name does not run into its value", () => {
    const tooltip = document.createElement("div");
    tooltip.innerHTML = "<b>series 1</b><span>108.44</span>";
    expect(tooltip.textContent).toBe("series 1108.44");
    expect(readoutText(tooltip)).toBe("series 1 108.44");
    expect(writes(readoutText(tooltip), 108.43789)).toBe(true);
  });
});

describe("source data bytes", () => {
  it("counts typed arrays' bytes and strings' UTF-16 units, each array once", () => {
    const x = new Float64Array(10);
    const data = { x, ys: [new Float64Array(10), new Float32Array(10)], names: ["ab", "c"] };
    // 80 + 80 + 40 bytes of numbers, 3 code units of names.
    expect(dataBytes(data)).toBe(206);
    // Two charts sharing an x column count it once.
    expect(dataBytes([{ x }, { x }])).toBe(80);
    // Views of one buffer count its bytes once, overlapping or not.
    const buffer = new Float64Array(10);
    expect(dataBytes([buffer.subarray(0), buffer.subarray(2, 6), buffer.subarray(8)])).toBe(80);
    expect(dataBytes([buffer.subarray(0, 4), buffer.subarray(6)])).toBe(64);
  });
});
