// Marks of rows placed by coordinates (marks/row-bindings.ts): the checks
// of each coordinate whole, and the scales that place a bound direction.
// Marks keep only what binds each direction, so that a line without
// coordinates carries none of this; charts with coordinates load the
// feature compiler, which runs these checks and projects their frames.

import type { FieldKind } from "../../data/column.ts";
import type { AxisContext } from "../../model/axis.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { PositionScale } from "../../scale/scale.ts";
import type { Frame, Mark } from "../mark.ts";
import type { RowBindings } from "../row-bindings.ts";
import type { Where } from "./compile.ts";

const LINEAR = { type: "linear" } as AxisContext;

/** The positions marks of rows bind, x's and y's alike. */
const KEYS = ["x", "x1", "x2", "y", "y1", "y2"];

/**
 * Checks `mark`'s coordinates: each one's shape, that the positions along
 * one direction bind alike, that a scale x, y, or yRight is the axis'
 * own (and y on yRight's, with `axis: "right"`), and that the fields
 * shares and pixels read hold numbers (and those on a scale of the
 * chart's own, numbers or times). Throws an error whose
 * message starts at the option, as the feature compiler's do.
 */
export function checkPositions(mark: Mark, where: Where): void {
  const spec = mark.spec as unknown as Record<string, unknown> & { axis?: string };
  const refuse = (location: string, problem: string, code = "invalid-option") => {
    throw Object.assign(new Error(`${where.path} ${location}: ${problem}`), { code });
  };
  // The first position along each direction, and how it binds ("" as its axis does).
  const first: Record<string, [string, string]> = {};
  for (const key of KEYS) {
    const place = spec[key];
    if (place === undefined) continue;
    const axis = key[0]!;
    const own = axis === "x" ? "x" : spec.axis === "right" ? "yRight" : "y";
    const coordinate = typeof place === "object" && !Array.isArray(place);
    const c = (coordinate ? place : {}) as {
      field?: string;
      scale?: unknown;
      frame?: unknown;
      offset?: unknown;
    };
    // One form, with the options it takes, as the spec's validator says.
    if (coordinate && ["data", "field", "fraction", "px"].filter((form) => form in c).length !== 1)
      refuse(
        key,
        "expected one of { data }, { field }, { fraction }, or { px }, with an offset; received an object",
      );
    const unit = "fraction" in c ? "fraction" : "px" in c ? "px" : undefined;
    const given = (option: unknown) =>
      typeof option === "string" ? JSON.stringify(option) : String(option);
    if ("frame" in c && !unit)
      refuse(`${key}.frame`, `expected absent for values on a scale; received ${given(c.frame)}`);
    if ("scale" in c && unit)
      refuse(
        `${key}.scale`,
        `expected absent for fractions and pixels; received ${given(c.scale)}`,
      );
    if (unit && c.frame !== undefined && c.frame !== "plot" && c.frame !== "chart")
      refuse(`${key}.frame`, `expected "plot" or "chart"; received ${given(c.frame)}`);
    if (c.scale !== undefined && typeof c.scale !== "string")
      refuse(`${key}.scale`, `expected a scale's name; received ${given(c.scale)}`);
    if (c.offset !== undefined && !(typeof c.offset === "number" && Number.isFinite(c.offset)))
      refuse(`${key}.offset`, `expected a finite number of pixels; received ${c.offset}`);
    const scale = c.scale as string | undefined;
    if ((scale === "x" || scale === "y" || scale === "yRight") && scale !== own)
      refuse(
        `${key}.scale`,
        `"${scale}" is not this ${axis} axis' scale ("${own}"); ${scale === "yRight" ? 'give axis: "right"' : `name "${own}"`}`,
      );
    // Each position along a direction binds as its first one does.
    const on = unit ?? (scale === undefined || scale === own ? "" : scale);
    const binding =
      on || c.offset ? JSON.stringify([on, unit && (c.frame ?? "plot"), c.offset ?? 0]) : "";
    first[axis] ??= [key, binding];
    const [by, bound] = first[axis];
    if (bound !== binding)
      refuse(
        key,
        `placed otherwise than ${by}; place ${by} and ${key} alike, on one scale or in one frame, with one offset`,
        "unsupported",
      );
    if (!on) continue;
    if (axis === "y" && spec.axis === "right")
      refuse("axis", `"right" places y on yRight's scale, which ${by} is not on; drop axis`);
    // A field the mark does not have it reported itself.
    const field = c.field ?? (c as Record<string, { field: string }>)[unit!]!.field;
    if (!mark.table?.has(field)) continue;
    const kinds: FieldKind[] = unit ? ["number"] : ["number", "time"];
    const holds = mark.table.kind(field);
    if (!kinds.includes(holds))
      refuse(
        `${key}${unit ? `.${unit}` : ""}.field`,
        `field "${field}" holds ${holds} values; expected ${kinds.join(" or ")}${holds === "category" ? "; give numbers, not strings" : ""}`,
        "field-type",
      );
  }
}

/**
 * `frame` with each direction `bound` binds placed by its scale: a share
 * of the plot or the chart, pixels from its edge, or the frame's scale of
 * the chart's own (`scaleOf`), each moved by its offset. Every scale runs
 * over the plot's pixels, as the axes' do, and its domain is what those
 * show: marks cull, index, and inspect rows by it as by any frame's.
 */
export function boundFrame(kit: FeatureKit, frame: Frame, bound: RowBindings): Frame {
  const scale = (axis: "x" | "y"): PositionScale => {
    const binding = bound[axis];
    if (!binding) return frame[axis];
    const { offset } = binding;
    if (binding.kind === "axis") return moved(frame[axis], offset);
    if (binding.kind === "scale") return moved(frame.scaleOf!(binding.scale, axis), offset);
    const box = binding.frame === "chart" ? (frame.chart ?? frame.plot) : frame.plot;
    const { plot } = frame;
    const [start, length] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
    // The pixel of 0 and pixels per unit: shares run up from the bottom,
    // as plots do; pixels down from the top, as screens do.
    const up = binding.unit === "fraction" && axis === "y";
    const zero = (up ? start + length : start) + offset;
    const per = binding.unit === "px" ? 1 : up ? -length : length;
    const range: [number, number] =
      axis === "x"
        ? [plot.x, plot.x + plot.width]
        : up
          ? [plot.y + plot.height, plot.y]
          : [plot.y, plot.y + plot.height];
    const domain: [number, number] = per
      ? [(range[0] - zero) / per, (range[1] - zero) / per]
      : [0, 0];
    return kit.createScale(LINEAR, domain, range);
  };
  return { ...frame, x: scale("x"), y: scale("y") };
}

/**
 * `scale` placing every value `by` pixels further along, over the same
 * range: its domain is what that range shows of it. Its own methods are
 * reached through it, not inherited, so scales with private state work.
 */
function moved(scale: PositionScale, by: number): PositionScale {
  if (by === 0) return scale;
  const { range, start, breaks, categories, bandwidth } = scale;
  return {
    type: scale.type,
    domain: [scale.invert(range[0] - by), scale.invert(range[1] - by)],
    range,
    map: (value) => scale.map(value) + by,
    invert: (pixel) => scale.invert(pixel - by),
    ticks: (count) => scale.ticks(count),
    mapping: () => {
      const mapping = scale.mapping();
      return { ...mapping, offset: mapping.offset + by };
    },
    ...(breaks && { breaks }),
    ...(categories && { categories, bandwidth }),
    ...(start && { start: (index: number) => start.call(scale, index) + by }),
  };
}
