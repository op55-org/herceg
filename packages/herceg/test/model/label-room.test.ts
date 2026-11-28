// Rooms of the outside label column (`place.room` on series labels, text
// following series, and horizontal rules' labels): the labels' width in
// their track beside the plot, `offset` on top, a fixed one kept from the
// first frame whatever is drawn, or bounds on what they measure; labels
// wider than a fixed room or its `max` shortened with an ellipsis as drawn,
// and whole wherever else the chart names them.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { ruleLabel } from "../../src/draw/rule.ts";
import { loadSpec, validateSpec } from "../../src/from-spec.ts";
import { axis } from "../../src/guides/options.ts";
import { fitLabel } from "../../src/layout/attached.ts";
import { estimateText, fitText, textLines } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { describeChart } from "../../src/model/describe.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measurePdfText } from "../../src/render/pdf-fonts.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type {
  LabelsGeometry,
  Panel,
  RuleGeometry,
  Scene,
  SegmentGeometry,
  TextItem,
} from "../../src/scene/scene.ts";
import type { SeriesLabelsSpec } from "../../src/spec/encoding.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { checkSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";

const WIDTH = 900;
function model(config: ChartConfig, width = WIDTH, height = 300) {
  const made = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    staticCompilers(),
  );
  made.setSize(width, height, 1);
  return made;
}
const sceneOf = (config: ChartConfig, width?: number, height?: number) =>
  model(config, width, height).scene(estimateText);

const labelsOf = (panel: Panel): TextItem[] =>
  panel.marks.filter((g): g is LabelsGeometry => g.kind === "labels").flatMap((g) => [...g.items]);
const textsOf = (scene: Scene) => labelsOf(scene.panels[0]!).map((item) => item.text);
const right = ({ plot }: Panel) => plot.x + plot.width;
/**
 * Pixels the right track keeps in a chart `WIDTH` wide without a right y
 * axis, in automatic spacing: what stands between the plot and the edge,
 * less the 12 px from the plot to the track and the 8 px edge inset.
 */
const track = (scene: Scene) => WIDTH - right(scene.panels[0]!) - 12 - 8;
/** Where text is painted along x, its halo too. */
function extent(item: TextItem): [number, number] {
  const { width } = textLines(item.text, item.paint, estimateText);
  const reach = (item.halo?.width ?? 0) / 2;
  const start = item.x - width * (item.anchor === "end" ? 1 : item.anchor === "middle" ? 0.5 : 0);
  return [start - reach, start + width + reach];
}

/** A PDF's page content, its streams inflated. */
function pdfContent(pdf: Uint8Array): string {
  const text = Buffer.from(pdf).toString("latin1");
  let content = "";
  for (const match of text.matchAll(/\/FlateDecode \/Length (\d+) >>\nstream\n/g)) {
    const at = match.index + match[0].length;
    content += inflateSync(Buffer.from(text.slice(at, at + Number(match[1])), "latin1")).toString(
      "latin1",
    );
  }
  return content;
}

const MINUTE = 60_000;
const minutes = Float64Array.from({ length: 30 }, (_, k) => k * MINUTE);
const wave = (s: number) => Float64Array.from(minutes, (_, k) => 100 + s * 200 + 20 * Math.sin(k));
const NAMES = ["auth", "payments", "recommendations-engine"] as const;
const metrics = table({
  time: time(minutes),
  auth: wave(0),
  payments: wave(1),
  "recommendations-engine": wave(2),
});
type Names = Omit<SeriesLabelsSpec, "content">;
/** A1's names: beside the plot, 8 px out, with leaders, in a room of 64 px. */
const A1 = {
  at: "visible-end",
  place: { outside: true, offset: 8, room: 64 },
  leader: true,
} as const satisfies Names;
const named = (
  labels: Names = A1,
  names: readonly (typeof NAMES)[number][] = NAMES,
): ChartConfig => ({
  y: { domain: [0, 600] },
  marks: [line(metrics, { x: "time", y: [...names], labels })],
});
/** How wide `name` is in the series labels' default text, as estimated. */
const widthOf = (name: string) => estimateText(name, "12px sans-serif");

describe("a fixed room", () => {
  contractTest("labels.attach.room.fixed", () => {
    const scene = sceneOf(named());
    const panel = scene.panels[0]!;
    // The track keeps the room, the offset on top.
    expect(track(scene)).toBe(64 + 8);
    const labels = labelsOf(panel);
    expect(labels.map((l) => l.text)).toEqual(["auth", "payments", expect.stringMatching(/…$/)]);
    for (const label of labels) {
      // At the offset past the 6 px gap past the plot, each within the room:
      // its halo past its start stands in the offset, past its end in the room.
      expect(label.x).toBe(right(panel) + 6 + 8);
      expect(extent(label)[1]).toBeLessThanOrEqual(label.x + 64 + 1e-9);
    }
    // The longest name is shortened to the most that fits, its halo too.
    const cut = labels[2]!;
    const reach = (cut.halo?.width ?? 0) / 2;
    const kept = Array.from(cut.text).length - 1;
    expect(widthOf(cut.text) + reach).toBeLessThanOrEqual(64);
    expect(widthOf(`${"recommendations-engine".slice(0, kept + 1)}…`) + reach).toBeGreaterThan(64);
    // The same plot whatever the names measure.
    for (const names of [["auth"], ["recommendations-engine"], NAMES] as const)
      expect(sceneOf(named(A1, names)).panels[0]!.plot).toEqual(panel.plot);
  });

  it("is the labels' width, so a room of what they measure lays the chart out as no room", () => {
    const labels = { at: "last", place: { outside: true, offset: 8 } } as const;
    // Labels measure their text and their halo past it.
    const measured = sceneOf(named(labels, ["payments"]));
    const halo = labelsOf(measured.panels[0]!)[0]!.halo!.width / 2;
    const room = Math.ceil(widthOf("payments") + halo);
    expect(track(measured)).toBe(room + 8);
    const roomed = sceneOf(named({ ...labels, place: { ...labels.place, room } }, ["payments"]));
    expect(roomed.panels[0]!.plot).toEqual(measured.panels[0]!.plot);
    expect(textsOf(roomed)).toEqual(["payments"]);
  });

  contractTest("labels.attach.room.before-drawing", () => {
    const whole = sceneOf(named()).panels[0]!;
    const before = (config: ChartConfig, hide = false) => {
      const chart = model(config);
      if (hide) for (const s of chart.series()) chart.hidden.add(s.key);
      return chart.scene(estimateText);
    };
    // Empty data: no axes are drawn, so the plot starts at the edge; the
    // track still holds.
    const empty = table({ time: time([]), auth: [] as number[] });
    const none = before({ marks: [line(empty, { x: "time", y: "auth", labels: A1 })] });
    expect(right(none.panels[0]!)).toBe(right(whole));
    expect(textsOf(none)).toEqual([]);
    // Every series hidden.
    const hidden = before(named(), true);
    expect(hidden.panels[0]!.plot).toEqual(whole.plot);
    expect(textsOf(hidden)).toEqual([]);
    // No point in view to label.
    const past = before({ ...named(), x: { domain: [100 * MINUTE, 200 * MINUTE] } });
    expect(right(past.panels[0]!)).toBe(right(whole));
    expect(textsOf(past)).toEqual([]);
    // No label surviving: a room too narrow for an ellipsis, and a plot too
    // short for any label to stand in.
    const narrow = before(named({ ...A1, place: { outside: true, offset: 8, room: 2 } }));
    expect(textsOf(narrow)).toEqual([]);
    expect(track(narrow)).toBe(2 + 8);
    const flat = model(named(), WIDTH, 30).scene(estimateText);
    expect(textsOf(flat)).toEqual([]);
    expect(right(flat.panels[0]!)).toBe(right(whole));
  });

  it("keeps its side: before the series' start for labels at the first point", () => {
    const first = (room: number) =>
      sceneOf(named({ at: "first", place: { outside: true, offset: 8, room } }, ["auth"]))
        .panels[0]!;
    // The left track holds the room: a wider one moves the plot's start by as much.
    expect(first(100).plot.x - first(64).plot.x).toBe(36);
    expect(right(first(100))).toBe(right(first(64)));
    expect(labelsOf(first(64))[0]!.anchor).toBe("end");
  });

  it("holds for areas, text following series, and the style's alignment", () => {
    const whole = right(sceneOf(named()).panels[0]!);
    const ofArea = sceneOf({
      y: { domain: [0, 600] },
      marks: [area(metrics, { x: "time", y: "auth", labels: A1 })],
    });
    expect(right(ofArea.panels[0]!)).toBe(whole);
    const following = sceneOf({
      y: { domain: [0, 600] },
      marks: [
        line(metrics, { id: "m", x: "time", y: [...NAMES] }),
        text({
          from: { mark: "m", at: "visible-end" },
          label: { text: "a long note beside it", place: { outside: true, offset: 8, room: 64 } },
        }),
      ],
    });
    expect(right(following.panels[0]!)).toBe(whole);
    expect(textsOf(following).every((t) => t.endsWith("…"))).toBe(true);
    // Aligned to their end by their style, labels go in the left track.
    const left = sceneOf(
      named({ at: "last", place: { outside: true, room: 50 }, style: { align: "end" } }, ["auth"]),
    ).panels[0]!;
    const plain = sceneOf(named({ at: "last", place: { outside: true, room: 50 } }, ["auth"]));
    expect(left.plot.x).toBeGreaterThan(plain.panels[0]!.plot.x + 40);
  });
});

describe("a room of bounds", () => {
  contractTest("labels.attach.room.bounds", () => {
    const place = (room: object) => ({ at: "last", place: { outside: true, offset: 8, room } });
    const measured = track(sceneOf(named({ at: "last", place: { outside: true, offset: 8 } })));
    // Below its least, the track keeps the least; above it, what they measure.
    expect(track(sceneOf(named(place({ min: 400 }) as Names)))).toBe(400 + 8);
    expect(track(sceneOf(named(place({ min: 10 }) as Names)))).toBe(measured);
    // `min` alone never shortens.
    expect(textsOf(sceneOf(named(place({ min: 10 }) as Names)))).toEqual([...NAMES]);
    // Above its most, the track keeps the most, and longer labels are shortened to it.
    const most = sceneOf(named(place({ max: 50 }) as Names));
    expect(track(most)).toBe(50 + 8);
    expect(textsOf(most)).toEqual([
      "auth",
      expect.stringMatching(/…$/),
      expect.stringMatching(/…$/),
    ]);
    // Labels within it keep what they measure.
    const short = sceneOf(named(place({ max: 200 }) as Names, ["auth"]));
    expect(track(short)).toBe(
      track(sceneOf(named({ at: "last", place: { outside: true, offset: 8 } }, ["auth"]))),
    );
    // The least holds where no label is drawn.
    const chart = model(named(place({ min: 60 }) as Names));
    for (const s of chart.series()) chart.hidden.add(s.key);
    expect(track(chart.scene(estimateText))).toBe(60 + 8);
  });
});

describe("labels wider than their room", () => {
  contractTest("labels.attach.room.shortened", () => {
    // Plain labels, line by line.
    const lines = sceneOf(
      named(
        {
          at: "last",
          content: [{ series: true }, "\nsecond line, longer"],
          place: { outside: true, room: 60 },
        } as SeriesLabelsSpec,
        ["auth"],
      ),
    );
    const [first, second] = textsOf(lines)[0]!.split("\n");
    expect(first).toBe("auth");
    expect(second).toMatch(/^second.*…$/);
    // A label of parts from its end, its parts' looks kept.
    const parts = sceneOf(
      named(
        {
          at: "last",
          content: [{ series: true, style: { fontWeight: 700 } }, " at ", { value: true }],
          place: { outside: true, room: 70 },
        } as SeriesLabelsSpec,
        ["payments"],
      ),
    );
    const items = labelsOf(parts.panels[0]!);
    const bold = items.find((item) => item.text === "payments")!;
    expect(bold.paint.weight).toBe(700);
    expect(items.map((item) => item.text).join("")).toMatch(/^payments.*…$/);
    expect(items.map((item) => item.text).join("")).not.toMatch(/\d…?$/);
    // A room too narrow for the ellipsis leaves the label out.
    const narrow = sceneOf(named({ at: "last", place: { outside: true, room: 4 } }, ["auth"]));
    expect(textsOf(narrow)).toEqual([]);
  });

  it("shortens only labels wider than their room, and measures those within it once", () => {
    const fits: string[] = [];
    const fit = (text: string, width: number, measure: typeof estimateText, font: string) => {
      fits.push(text);
      return fitText(text, width, measure, font);
    };
    const font = "12px sans-serif";
    expect(fitLabel("SLO\np99", undefined, 64, font, estimateText, fit)).toEqual([
      "SLO\np99",
      undefined,
    ]);
    expect(fits).toEqual([]);
    const [cut] = fitLabel("SLO\nrecommendations-engine", undefined, 64, font, estimateText, fit)!;
    expect(cut).toMatch(/^SLO\nrecomm.*…$/);
  });

  contractTest("labels.attach.room.leaders", () => {
    // Two lines ending together: their names move apart, their leaders back
    // to their points, each ending at its label's start.
    const close = table({ time: time([0, MINUTE]), a: [100, 300], b: [100, 301] });
    const scene = sceneOf({
      y: { domain: [0, 600] },
      marks: [
        line(close, {
          x: "time",
          y: ["a", "b"],
          labels: {
            at: "last",
            content: [{ series: true }, " is a long name"],
            place: { outside: true, offset: 8, room: 50 },
            leader: true,
          },
        }),
      ],
    });
    const panel = scene.panels[0]!;
    const labels = labelsOf(panel);
    expect(labels.every((l) => l.text.endsWith("…"))).toBe(true);
    const leaders = panel.marks.filter((g): g is SegmentGeometry => g.kind === "segments");
    const ends = leaders.flatMap((g) =>
      Array.from({ length: g.count }, (_, k) => g.coords[4 * k + 2]!),
    );
    expect(ends.length).toBe(2);
    for (const end of ends)
      expect(labels.some((label) => Math.abs(extent(label)[0] - end) < 1e-3)).toBe(true);
  });

  contractTest("labels.attach.room.whole-names", () => {
    const chart = model({ ...named(), legend: true });
    const scene = chart.scene(estimateText);
    expect(textsOf(scene)).not.toContain("recommendations-engine");
    // The legend and the text alternative name the series whole.
    expect(JSON.stringify(scene.guides)).toContain('"recommendations-engine"');
    expect(describeChart(chart)).toContain("recommendations-engine");
    expect(chart.series().map((s) => s.label)).toContain("recommendations-engine");
  });
});

describe("streaming names", () => {
  contractTest("labels.attach.room.streaming", () => {
    // Services come, change their names, and leave as rows stream in.
    const live = table({
      time: time([0, MINUTE]),
      ms: [100, 200],
      service: ["api", "db"],
    });
    const config = (labels: Names): ChartConfig => ({
      y: { domain: [0, 600] },
      marks: [line(live, { x: "time", y: "ms", series: "service", labels })],
    });
    const roomed = model(config(A1));
    const measured = model(config({ ...A1, place: { outside: true, offset: 8 } }));
    const plots = new Set<string>();
    const grown = new Set<number>();
    const names = ["api", "a-much-longer-service-name", "db", "x", "queue-workers-eu-west"];
    for (let k = 2; k < 40; k++) {
      live.append({
        time: [k * MINUTE],
        ms: [100 + (k % 5) * 50],
        service: [names[k % names.length]!],
      });
      if (k > 10) live.dropFirst(1);
      plots.add(JSON.stringify(roomed.scene(estimateText).panels[0]!.plot));
      grown.add(right(measured.scene(estimateText).panels[0]!));
    }
    // The plot never moves; measured, it moves as names come.
    expect(plots.size).toBe(1);
    expect(grown.size).toBeGreaterThan(1);
  });

  it("are shortened as a chart made at each frame shortens them, each name fitted once", () => {
    const live = table({ time: time([0, MINUTE]), ms: [100, 200], service: ["api", "db"] });
    const config: ChartConfig = {
      y: { domain: [0, 600] },
      marks: [line(live, { x: "time", y: "ms", series: "service", labels: A1 })],
    };
    const streamed = model(config);
    const { measure, measured } = recording();
    const names = ["api", "a-much-longer-service-name", "db", "x", "queue-workers-eu-west"];
    for (let k = 2; k < 40; k++) {
      live.append({
        time: [k * MINUTE],
        ms: [100 + (k % 5) * 50],
        service: [names[k % names.length]!],
      });
      if (k > 10) live.dropFirst(1);
      measured.length = 0;
      const scene = streamed.scene(measure);
      expect(textsOf(scene)).toEqual(textsOf(sceneOf(config)));
      // Once every name has been drawn, none is fitted again.
      if (k >= 2 + names.length) expect(tried(measured, scene)).toEqual([]);
    }
    expect(textsOf(streamed.scene(estimateText))).toContainEqual(
      expect.stringMatching(/^a-much.*…$/),
    );
  });
});

/** A measurer recording the text it measures. */
function recording() {
  const measured: string[] = [];
  const measure: typeof estimateText = (text, font) => {
    measured.push(text);
    return estimateText(text, font);
  };
  return { measure, measured };
}

/** The shortened text `measured` that `scene` draws no label of: tried in fitting labels. */
function tried(measured: readonly string[], scene: Scene): string[] {
  const drawn = new Set(textsOf(scene));
  return measured.filter((text) => text.endsWith("…") && !drawn.has(text));
}

describe("names fitted to their room", () => {
  it("are each chart's own, fitted again in another theme or with another measurer", () => {
    const config = { ...named(), theme: "auto" } satisfies ChartConfig;
    const { measure, measured } = recording();
    const fitted = (chart: ChartModel, by = measure) => {
      measured.length = 0;
      const scene = chart.scene(by);
      expect(textsOf(scene)).toEqual(textsOf(sceneOf(named())));
      return tried(measured, scene).length;
    };
    const chart = model(config);
    expect(fitted(chart)).toBeGreaterThan(0);
    expect(fitted(chart)).toBe(0);
    // Another chart fits its own.
    expect(fitted(model(config))).toBeGreaterThan(0);
    expect(fitted(chart)).toBe(0);
    // On a dark page, its theme another.
    expect(chart.refreshTheme({ dark: true })).toBe(true);
    expect(fitted(chart)).toBeGreaterThan(0);
    expect(fitted(chart)).toBe(0);
    // Another measurer, as faces loaded give.
    const other = recording();
    measured.length = 0;
    const scene = chart.scene(other.measure);
    expect(tried(other.measured, scene).length).toBeGreaterThan(0);
  });

  it("fit labels of parts by their parts, though another label has their text", () => {
    // The same text, "payments at …", the series' name larger in one, the value in the other.
    const larger = (part: "series" | "value") =>
      line(metrics, {
        x: "time",
        y: "payments",
        labels: {
          at: "last",
          content: [
            { series: true, ...(part === "series" && { style: { fontSize: 16 } }) },
            " at ",
            { value: true, ...(part === "value" && { style: { fontSize: 16 } }) },
          ],
          place: { outside: true, room: 120 },
        },
      });
    const partsOf = (scene: Scene) =>
      labelsOf(scene.panels[0]!).map(({ text, paint }) => [text, paint.size]);
    const alone = (part: "series" | "value") =>
      partsOf(sceneOf({ y: { domain: [0, 600] }, marks: [larger(part)] }));
    const both = partsOf(
      sceneOf({ y: { domain: [0, 600] }, marks: [larger("series"), larger("value")] }),
    );
    expect(both).toEqual([...alone("series"), ...alone("value")]);
    // Each shortened in its value: by more where the name is the larger.
    const cut = (part: "series" | "value") => alone(part).at(-1)![0] as string;
    expect(cut("series")).toMatch(/^\d+…$/);
    expect(cut("value")).toMatch(/^\d+…$/);
    expect(cut("series")).not.toBe(cut("value"));
  });
});

describe("rules' labels outside the plot", () => {
  const data = table({ time: time(minutes), v: wave(0) });
  const base = (marks: ChartConfig["marks"]): ChartConfig => ({
    y: { domain: [0, 600] },
    marks: [line(data, { x: "time", y: "v" }), ...marks],
  });

  contractTest("rule.label.room", () => {
    const label = "a threshold with a long name";
    const fixed = sceneOf(
      base([
        rule({ y: 300, label: { text: label, place: { outside: true, offset: 4, room: 60 } } }),
      ]),
    );
    expect(track(fixed)).toBe(64);
    const [drawn] = textsOf(fixed);
    expect(drawn).toMatch(/^a thr.*…$/);
    expect(widthOf(drawn!)).toBeLessThanOrEqual(60);
    // Kept with no rule in view, from the options alone.
    const away = sceneOf(
      base([
        rule({ y: 5000, label: { text: label, place: { outside: true, offset: 4, room: 60 } } }),
      ]),
    );
    expect(textsOf(away)).toEqual([]);
    expect(right(away.panels[0]!)).toBe(right(fixed.panels[0]!));
    // Bounds hold what they measure; a box's padding and outline are in the room.
    const boxed = { background: { fill: "#eee", stroke: "#999", strokeWidth: 2 }, padding: 3 };
    const bounded = sceneOf(
      base([
        rule({
          y: 300,
          label: { text: label, style: boxed, place: { outside: true, room: { max: 60 } } },
        }),
      ]),
    );
    expect(track(bounded)).toBe(60);
    const item = labelsOf(bounded.panels[0]!)[0]!;
    expect(item.box!.width + 2).toBeLessThanOrEqual(60 + 1e-9);
    expect(
      track(
        sceneOf(
          base([
            rule({ y: 300, label: { text: "SLO", place: { outside: true, room: { min: 40 } } } }),
          ]),
        ),
      ),
    ).toBe(40);
    // At the rule's start, the left track.
    const start = sceneOf(
      base([
        rule({
          y: 300,
          label: { text: label, place: { outside: true, attachment: "start", room: 60 } },
        }),
      ]),
    );
    expect(labelsOf(start.panels[0]!)[0]!.anchor).toBe("end");
    // A horizontal rule along no length is still horizontal.
    const point = sceneOf(
      base([
        rule({
          y: 300,
          span: [{ fraction: 0.5 }, { fraction: 0.5 }],
          label: { text: label, place: { outside: true, room: 60 } },
        }),
      ]),
    );
    expect(labelsOf(point.panels[0]!)[0]!.x).toBe(labelsOf(fixed.panels[0]!)[0]!.x);
    expect(labelsOf(point.panels[0]!)[0]!.anchor).toBe("start");
  });

  it("places the labels of a horizontal rule along no length as a horizontal rule's", () => {
    // Its ends tell no direction (x1 === x2 as a vertical rule's), so its
    // options do: as a rule along a sliver of length is placed.
    const along = (length: number) => [{ fraction: 0.5 }, { fraction: 0.5 + length }] as const;
    const events = table({ at: [300, 300], name: ["deploy A", "deploy B"] });
    const placed = (length: number) => {
      const scene = sceneOf(
        base([
          rule({ y: 300, span: along(length), label: "SLO" }),
          rule(events, { y: "at", span: along(length), label: { field: "name", overlap: "move" } }),
        ]),
      );
      const [ruled] = scene.panels[0]!.marks.filter((g): g is RuleGeometry => g.kind === "rule");
      const plain = ruled!.label
        ? { text: ruled!.label, ...ruleLabel(ruled!, 12) }
        : labelsOf(scene.panels[0]!).find((l) => l.text === "SLO")!;
      const moved = labelsOf(scene.panels[0]!).filter((l) => l.text.startsWith("deploy"));
      return { y: ruled!.y1, plain, moved };
    };
    const point = placed(0);
    const sliver = placed(0.0001);
    // The plain label ends at the rule's end, above it.
    expect(point.plain.anchor).toBe("end");
    expect(point.plain.x).toBeCloseTo(sliver.plain.x, 0);
    expect(point.plain.y).toBeLessThan(point.y);
    // Two labels at one place: the second moves to its mirror image below the rule.
    expect(point.moved.map((l) => l.y)).toEqual(sliver.moved.map((l) => l.y));
    for (const [k, l] of point.moved.entries()) expect(l.x).toBeCloseTo(sliver.moved[k]!.x, 0);
    expect(point.moved[0]!.y).toBeLessThan(point.y);
    expect(point.moved[1]!.y).toBeGreaterThan(point.y);
  });

  contractTest("labels.attach.room.track", () => {
    // The track is the most any mark on its side keeps.
    const wide = "a threshold label far wider than the names' room";
    const ruled = sceneOf({
      ...named(),
      marks: [...named().marks, rule({ y: 300, label: { text: wide, place: { outside: true } } })],
    });
    expect(track(ruled)).toBe(Math.ceil(widthOf(wide)));
    const narrower = sceneOf({
      ...named(),
      marks: [
        ...named().marks,
        rule({ y: 300, label: { text: wide, place: { outside: true, room: 20 } } }),
      ],
    });
    expect(track(narrower)).toBe(64 + 8);
  });
});

describe("charts side by side", () => {
  // Two charts naming their lines in one room, their y labels in another.
  const TICKS = [0, 10 * MINUTE, 20 * MINUTE, 29 * MINUTE];
  const upper = (format?: (v: number) => string): ChartConfig => ({
    y: { domain: [0, 600], room: 36 },
    x: { nice: false },
    marks: [line(metrics, { x: "time", y: [...NAMES], labels: A1 })],
    ...(format && { guides: [axis({ scale: "x", ticks: { values: TICKS }, format })] }),
  });
  const errors = table({
    time: time(minutes),
    errors: Float64Array.from(minutes, (_, k) => k % 7),
  });
  const lower = (format?: (v: number) => string): ChartConfig => ({
    y: { domain: [0, 10], room: 36 },
    x: { nice: false },
    marks: [line(errors, { x: "time", y: "errors", labels: { ...A1, leader: false } })],
    // Ticks to the plot's end, where the last label is centered.
    ...(format && { guides: [axis({ scale: "x", ticks: { values: TICKS }, format })] }),
  });

  contractTest("labels.attach.room.aligned", () => {
    const a = sceneOf(upper(), WIDTH, 300).panels[0]!;
    const b = sceneOf(lower(), WIDTH, 150).panels[0]!;
    expect([b.plot.x, b.plot.width]).toEqual([a.plot.x, a.plot.width]);
    // An x axis' end label within what stands beside the plot keeps them in line.
    const short = (v: number) => `${Math.round(v / MINUTE)}`;
    const shortLower = sceneOf(lower(short), WIDTH, 150).panels[0]!;
    expect([shortLower.plot.x, shortLower.plot.width]).toEqual([a.plot.x, a.plot.width]);
    // One reaching past it widens that chart's margin, and they part.
    const long = (v: number) =>
      v >= 29 * MINUTE ? "the last minute, written out at length" : `${v / MINUTE}`;
    const longLower = sceneOf(lower(long), WIDTH, 150).panels[0]!;
    expect(longLower.plot.width).toBeLessThan(a.plot.width);
  });
});

describe("refusals", () => {
  const refused = (make: () => unknown, message: string) => expect(make).toThrow(message);

  contractTest("labels.attach.room.refused", () => {
    const at = { at: "last" } as const;
    const chart = (labels: unknown) => () =>
      sceneOf({ marks: [line(metrics, { x: "time", y: "auth", labels: labels as Names })] });
    refused(
      chart({ ...at, place: { outside: true, reserve: false, room: 72 } }),
      "line (mark 0) labels.place.room: labels that keep no room take none; drop room, or reserve",
    );
    refused(
      chart({ ...at, place: { room: 72 } }),
      "line (mark 0) labels.place.room: labels inside the plot take no room; place them outside",
    );
    refused(
      chart({ ...at, place: { outside: false, room: 72 } }),
      "labels inside the plot take no room; place them outside",
    );
    refused(
      chart({ ...at, place: { outside: true, room: -4 } }),
      "line (mark 0) labels.place.room: expected finite pixels of at least 0, or { min, max } with min no more than max; received -4",
    );
    refused(
      chart({ ...at, place: { outside: true, room: { min: 50, max: 30 } } }),
      "received { min: 50, max: 30 }",
    );
    // The order: no room kept before inside, before the room's value.
    refused(chart({ ...at, place: { reserve: false, room: -4 } }), "labels that keep no room");
    refused(
      () =>
        sceneOf({
          marks: [
            line(metrics, { id: "m", x: "time", y: "auth" }),
            text({
              from: { mark: "m", at: "last" },
              label: { text: "now", place: { room: 4 } as never },
            }),
          ],
        }),
      "text (mark 1) label.place.room: labels inside the plot take no room; place them outside",
    );
    refused(
      () => rule({ x: 3, label: { text: "deploy", place: { outside: true, room: 64 } } }),
      "rule label.place.room: a vertical rule's labels stand above or below the plot, where no track is kept; drop room",
    );
    refused(
      () => rule({ x: 3, label: { text: "deploy", place: { reserve: false, room: 64 } as never } }),
      "rule label.place.room: a vertical rule's labels",
    );
    // Horizontal rules' rooms are checked as the chart compiles them.
    const ruled = (place: unknown) => () =>
      sceneOf({ marks: [rule({ y: 3, label: { text: "SLO", place: place as never } })] });
    refused(
      ruled({ outside: true, reserve: false, room: 64 }),
      "rule (mark 0) label.place.room: labels that keep no room take none; drop room, or reserve",
    );
    refused(
      ruled({ room: 64 }),
      "rule (mark 0) label.place.room: labels inside the plot take no room; place them outside",
    );
    refused(
      ruled({ outside: true, room: Number.NaN }),
      "rule (mark 0) label.place.room: expected finite pixels of at least 0, or { min, max } with min no more than max; received NaN",
    );
    refused(
      () =>
        region({
          y1: 1,
          y2: 2,
          label: { text: "Budget", place: { outside: true, room: 64 } as never },
        }),
      "region label.place.room: a region's labels stand in it, where no track is kept; drop room",
    );
  });

  contractTest("labels.attach.room.refused.spec", () => {
    const spec = (mark: object, more: object[] = []) =>
      ({
        data: { t: { columns: { x: [0, 1], y: [1, 2] } } },
        marks: [{ data: "t", ...mark }, ...more],
      }) as unknown as ChartSpec;
    const series = (place: object) =>
      spec({ type: "line", x: "x", y: "y", labels: { at: "last", place } });
    const cases: [ChartSpec, string, string][] = [
      [
        series({ outside: true, reserve: false, room: 72 }),
        "marks[0].labels.place.room",
        "labels that keep no room take none; drop room, or reserve",
      ],
      [
        series({ room: 72 }),
        "marks[0].labels.place.room",
        "labels inside the plot take no room; place them outside",
      ],
      [
        series({ outside: true, room: -4 }),
        "marks[0].labels.place.room",
        "expected a number of at least 0; received -4",
      ],
      [
        spec({ type: "rule", x: 0, label: { text: "deploy", place: { outside: true, room: 64 } } }),
        "marks[0].label.place.room",
        "a vertical rule's labels stand above or below the plot, where no track is kept; drop room",
      ],
      [
        spec({ type: "rule", y: 1, label: { text: "SLO", place: { room: 64 } } }),
        "marks[0].label.place.room",
        "labels inside the plot take no room; place them outside",
      ],
      [
        spec({
          type: "region",
          y1: 0,
          y2: 1,
          label: { text: "Budget", place: { outside: true, room: 64 } },
        }),
        "marks[0].label.place.room",
        "a region's labels stand in it, where no track is kept; drop room",
      ],
      [
        spec({ type: "line", id: "l", x: "x", y: "y" }, [
          {
            type: "text",
            from: { mark: "l", at: "last" },
            label: { text: "now", place: { outside: true, reserve: false, room: 4 } },
          },
        ]),
        "marks[1].label.place.room",
        "labels that keep no room take none; drop room, or reserve",
      ],
    ];
    for (const [given, path, problem] of cases)
      for (const check of [validateSpec, checkSpec, loadSpec])
        expect(() => check(given), path).toThrow(
          expect.objectContaining({ path, message: `${path}: ${problem}` }),
        );
    // A room the spec gives is the room the chart keeps.
    const loaded = loadSpec({
      data: { t: { columns: { x: [0, 1], y: [1, 2] } } },
      marks: [
        {
          type: "line",
          data: "t",
          x: "x",
          y: "y",
          labels: { at: "last", place: { outside: true, offset: 8, room: { min: 90 } } },
        },
      ],
    } as unknown as ChartSpec);
    expect(track(sceneOf(loaded.config))).toBe(98);
  });
});

describe("static output", () => {
  contractTest("labels.attach.room.export", () => {
    const config = { ...named(), legend: false } as const;
    const sized = { ...config, width: WIDTH, height: 300, timeZone: "UTC" };
    // Static SVG draws the scene's shortened names, where the scene does.
    const scene = sceneOf(config);
    const svg = renderToSVG(sized);
    const context = { theme: scene.theme, encodeRaster: undefined };
    for (const g of scene.panels[0]!.marks)
      if (g.kind === "labels" || g.kind === "segments")
        expect(svg).toContain(g.draw.svg(g, context));
    expect(svg).not.toContain(">recommendations-engine<");
    // PDF measures in its own fonts: its names are shortened to the same
    // room by those, and the plot's right edge, which the room holds, is
    // the scene's (the y axis's ticks, measured in those fonts too, move
    // the left edge).
    const pdf = pdfContent(renderToPDF(sized));
    const inPdf = model(config).scene(measurePdfText);
    const right = (plot: { x: number; width: number }) => plot.x + plot.width;
    expect(right(inPdf.panels[0]!.plot)).toBe(right(scene.panels[0]!.plot));
    const names = labelsOf(inPdf.panels[0]!);
    expect(names.map((name) => name.text)).toContain("auth");
    expect(names.some((name) => name.text.endsWith("…"))).toBe(true);
    for (const name of names) {
      expect(measurePdfText(name.text, name.paint.css)).toBeLessThanOrEqual(64);
      expect(pdf).toContain(`(${name.text.replaceAll("…", "\\205")}) Tj`);
    }
  });
});
