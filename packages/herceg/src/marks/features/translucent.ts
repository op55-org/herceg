// Drawings of a geometry at an opacity of its own: a series' style's, which
// a selection's look replaces with its own (see `opaque`).

import type { Drawing, Geometry } from "../../scene/scene.ts";

const translucents = new WeakMap<Drawing<Geometry>, Map<number, Drawing<Geometry>>>();
/**
 * How many opacities of one drawing are kept: drawings such as lines' live
 * as long as the page, and opacities streaming in would otherwise stay.
 */
const KEPT_OPACITIES = 256;

/** The drawing each translucent one draws at its opacity (see `opaque`). */
const bases = new WeakMap<Drawing<Geometry>, Drawing<Geometry>>();

/** The drawing `draw` draws at an opacity of a series' own, or itself: what a look's opacity replaces it with. */
export function opaque(draw: Drawing<Geometry>): Drawing<Geometry> {
  return bases.get(draw) ?? draw;
}

/** A drawing of the same geometry at `opacity`, the same while it is among the last opacities asked for. */
export function translucent(draw: Drawing<Geometry>, opacity: number): Drawing<Geometry> {
  let byOpacity = translucents.get(draw);
  if (!byOpacity) {
    byOpacity = new Map();
    translucents.set(draw, byOpacity);
  }
  let made = byOpacity.get(opacity);
  if (made) return made;
  // The opacity asked for longest ago goes first.
  if (byOpacity.size >= KEPT_OPACITIES) byOpacity.delete(byOpacity.keys().next().value!);
  const { elements, canvas: paint } = draw;
  made = {
    ...draw,
    opacity: (draw.opacity ?? 1) * opacity,
    svg: (geometry, context) => `<g opacity="${opacity}">${draw.svg(geometry, context)}</g>`,
    elements:
      elements &&
      ((geometry, context) =>
        elements(geometry, context)?.map(({ tag, attributes }) => ({
          tag,
          attributes: { ...attributes, opacity: String(opacity * Number(attributes.opacity ?? 1)) },
        }))),
    canvas:
      paint &&
      ((context, geometry, options) => {
        const alpha = context.globalAlpha;
        context.globalAlpha = alpha * opacity;
        paint(context, geometry, options);
        context.globalAlpha = alpha;
      }),
  } as Drawing<Geometry>;
  byOpacity.set(opacity, made);
  bases.set(made, draw);
  return made;
}
