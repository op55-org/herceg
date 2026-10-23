import { rectMarkup } from "../draw/markup.ts";
import { canvasRasterUrl } from "../render/canvas.ts";
import { clipId, cutToChart, gridElement, guidesMarkup, underMarkup } from "../render/svg.ts";
import { eachPainted } from "../scene/paint.ts";
import type { Geometry, Panel, Rect, Scene, SvgContext, SvgElement } from "../scene/scene.ts";

const NS = "http://www.w3.org/2000/svg";

function element<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function set(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * What the layer keeps for one geometry or grid batch: its elements,
 * updated in place, or for drawings without elements, one group and a
 * hash of its markup.
 */
export interface Retained {
  kind: string;
  nodes: Element[];
  /** Hash of the group's markup; undefined for elements. */
  hash: number | undefined;
  /** Attribute names last set on each element, to remove ones no longer set. */
  names: string[][];
}

/**
 * A 53-bit hash of a string (cyrb53). Groups remember the hash of their
 * markup rather than the markup itself, which for path data would keep a
 * second copy of every drawn path in memory; a collision, which would skip
 * one update, is vanishingly unlikely at 53 bits.
 */
export function hash(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** What the layer keeps for one panel: its clips, and the group of what it paints, in order. */
export interface PanelNodes {
  /** Its plot's clip, and the markup of its rectangles: its plot's, or those insets over it leave visible. */
  clip: SVGClipPathElement;
  cut: string;
  /** With insets over the panel, what its geometry not cut to the plot keeps to, and its markup. */
  keep?: { clip: SVGClipPathElement; cut: string } | undefined;
  /** What it paints over its plot's background, in its order, each cut as its mark says. */
  content: SVGGElement;
  /** The nodes of its geometry, by key, and of its grid batches, by theirs. */
  marks: Map<string, Retained>;
  grids: Map<string, Retained>;
  /** Its plot's background, after an inset's box, when it has either, and its markup's hash. */
  back?: { group: SVGGElement; hash: number } | undefined;
}

/**
 * What a layer is made of: its elements, what it drew, and the hashes of
 * the markup its groups hold. A layer makes its own, or takes those of a
 * chart's server markup (dom/adopt.ts).
 */
export interface LayerParts {
  svg: SVGSVGElement;
  defs: SVGDefsElement;
  under: SVGGElement;
  guides: SVGGElement;
  overlay: SVGGElement;
  panels: Map<string, PanelNodes>;
  underHash: number;
  guidesHash: number;
  /** Clip paths made so far, for unique ids. */
  clips: number;
  chartClip: SVGRectElement | undefined;
}

/** The parts of a new, empty layer. */
function newParts(document: Document): LayerParts {
  const svg = element(document, "svg", { "aria-hidden": "true" });
  svg.style.cssText = "position:absolute;left:0;top:0;overflow:visible";
  const parts: LayerParts = {
    svg,
    defs: element(document, "defs"),
    under: element(document, "g"),
    guides: element(document, "g"),
    overlay: element(document, "g", { "pointer-events": "none" }),
    panels: new Map(),
    underHash: hash(""),
    guidesHash: hash(""),
    clips: 0,
    chartClip: undefined,
  };
  svg.append(parts.defs, parts.under, parts.guides, parts.overlay);
  return parts;
}

/** A geometry's elements, cut to `clip` (a clip path's `url(...)`), for drawings that have them. */
export function elementsOf(
  mark: Geometry,
  context: SvgContext,
  clip: string | undefined,
): SvgElement[] | undefined {
  const elements = mark.draw.elements?.(mark, context);
  return elements && clip
    ? elements.map(({ tag, attributes }) => ({
        tag,
        attributes: { ...attributes, "clip-path": clip },
      }))
    : elements;
}

/**
 * Retained SVG output. Each panel's grid batches and geometry are nodes
 * kept by key, in the panel's paint order: elements updated attribute by
 * attribute, or a group per geometry whose markup is rewritten only when it
 * changes; nodes that move keep their identity. The backgrounds and the
 * guides are rebuilt only when their markup changes. The overlay group
 * belongs to the pointer layer.
 */
export class SvgLayer {
  readonly svg: SVGSVGElement;
  readonly overlay: SVGGElement;
  readonly #document: Document;
  readonly #defs: SVGDefsElement;
  /** The chart's background, followed by each panel's groups in its paint order. */
  readonly #under: SVGGElement;
  /** Hashes of the markup the under and guides groups hold. */
  #underHash: number;
  #guidesHash: number;
  /** Axes, title, and color legend. */
  readonly #guides: SVGGElement;
  readonly #panels: Map<string, PanelNodes>;
  readonly #id: string;
  /** Clip paths made so far, for unique ids. */
  #clips: number;
  /** The chart's own clip, for marks cut to the chart; made when first needed. */
  #chartClip: SVGRectElement | undefined;

  constructor(document: Document, id: string, adopted?: LayerParts) {
    this.#document = document;
    this.#id = id;
    ({
      svg: this.svg,
      overlay: this.overlay,
      defs: this.#defs,
      under: this.#under,
      guides: this.#guides,
      panels: this.#panels,
      underHash: this.#underHash,
      guidesHash: this.#guidesHash,
      clips: this.#clips,
      chartClip: this.#chartClip,
    } = adopted ?? newParts(document));
  }

  #panelNodes(key: string): PanelNodes {
    let nodes = this.#panels.get(key);
    if (nodes) return nodes;
    nodes = {
      clip: this.#clipPath(`${this.#id}-clip-${this.#clips++}`),
      cut: "",
      content: element(this.#document, "g"),
      marks: new Map(),
      grids: new Map(),
    };
    this.#panels.set(key, nodes);
    return nodes;
  }

  /**
   * Draws the scene. With `marks: false` a canvas paints the backgrounds,
   * grid lines, and geometry, and the layer draws the guides only. Images
   * (heatmaps) are encoded on a canvas unless `encodeRaster` says how.
   */
  render(
    scene: Scene,
    options: { marks: boolean; encodeRaster?: SvgContext["encodeRaster"] },
  ): void {
    const { svg } = this;
    const { width, height, theme } = scene;
    set(svg, "width", String(width));
    set(svg, "height", String(height));
    set(svg, "viewBox", `0 0 ${width} ${height}`);
    set(svg, "font-family", theme.font);
    set(svg, "font-size", String(theme.fontSize));
    set(svg, "fill", theme.muted);

    const under = options.marks ? underMarkup(scene) : "";
    const underHash = hash(under);
    if (underHash !== this.#underHash) {
      this.#under.innerHTML = under;
      this.#underHash = underHash;
    }

    const document = this.#document;
    const context: SvgContext = {
      theme,
      encodeRaster: options.encodeRaster ?? ((raster) => canvasRasterUrl(raster, document)),
    };
    const seen = new Set<string>();
    if (cutToChart(scene)) {
      if (!this.#chartClip) {
        this.#chartClip = element(document, "rect");
        this.#clipPath(`${this.#id}-clip-chart`).append(this.#chartClip);
      }
      set(this.#chartClip, "width", String(width));
      set(this.#chartClip, "height", String(height));
    }
    // Panels' groups follow the chart's background in paint order, each
    // panel's background before its plan. Axes go over every panel.
    let previous: Element = this.#under;
    for (const panel of scene.painted ?? scene.panels) {
      seen.add(panel.key);
      const kept = this.#panelNodes(panel.key);
      this.#renderPanel(kept, panel, options.marks, context, scene);
      if (kept.back) previous = keepOrder(svg, kept.back.group, previous);
      previous = keepOrder(svg, kept.content, previous);
    }
    for (const [key, nodes] of this.#panels) {
      if (seen.has(key)) continue;
      nodes.clip.remove();
      nodes.keep?.clip.remove();
      nodes.content.remove();
      nodes.back?.group.remove();
      this.#panels.delete(key);
    }
    // The series legend is the chart's HTML buttons.
    const markup = guidesMarkup(scene, this.#id, false);
    const guidesHash = hash(markup);
    if (guidesHash !== this.#guidesHash) {
      this.#guides.innerHTML = markup;
      this.#guidesHash = guidesHash;
    }
  }

  #renderPanel(
    nodes: PanelNodes,
    panel: Panel,
    marks: boolean,
    context: SvgContext,
    scene: Scene,
  ): void {
    // Its background (only where geometry is SVG's), in a group of its own
    // when it has one.
    const back = marks ? underMarkup(scene, panel) : "";
    if (back) {
      nodes.back ??= { group: element(this.#document, "g"), hash: 0 };
      const markupHash = hash(back);
      if (markupHash !== nodes.back.hash) {
        nodes.back.group.innerHTML = back;
        nodes.back.hash = markupHash;
      }
    } else if (nodes.back) {
      nodes.back.group.remove();
      nodes.back = undefined;
    }
    const rects = (list: readonly Rect[]) => list.map((rect) => rectMarkup(rect, 0, "")).join("");
    const cut = rects(panel.visible ?? [panel.plot]);
    if (cut !== nodes.cut) {
      nodes.clip.innerHTML = cut;
      nodes.cut = cut;
    }
    // With insets over it, what it does not cut to its plot keeps off them.
    if (panel.keep) {
      nodes.keep ??= { clip: this.#clipPath(`${nodes.clip.id}-keep`), cut: "" };
      const keep = rects(panel.keep);
      if (keep !== nodes.keep.cut) {
        nodes.keep.clip.innerHTML = keep;
        nodes.keep.cut = keep;
      }
    } else if (nodes.keep) {
      nodes.keep.clip.remove();
      nodes.keep = undefined;
    }
    const seen = new Set<Retained>();
    let previous: Element | null = null;
    const place = (entry: Retained) => {
      seen.add(entry);
      for (const node of entry.nodes) previous = keepOrder(nodes.content, node, previous);
    };
    if (marks) {
      const chart = `${this.#id}-clip-chart`;
      eachPainted(
        panel,
        (batch) => {
          const old = nodes.grids.get(batch.key);
          const entry = this.#updateElements(old, "grid", [
            gridElement(batch, panel.plot, context.theme),
          ]);
          if (entry !== old) {
            for (const node of old?.nodes ?? []) node.remove();
            nodes.grids.set(batch.key, entry);
          }
          place(entry);
        },
        (mark) => {
          const id = clipId(mark, nodes.clip.id, nodes.keep?.clip.id, chart);
          const clip = id && `url(#${id})`;
          const old = nodes.marks.get(mark.key);
          const elements = elementsOf(mark, context, clip);
          const entry = elements
            ? this.#updateElements(old, mark.kind, elements)
            : this.#updateMarkup(old, mark.kind, mark.draw.svg(mark, context));
          if (!elements) {
            const group = entry.nodes[0]!;
            if (clip) set(group, "clip-path", clip);
            else group.removeAttribute("clip-path");
          }
          if (entry !== old) {
            for (const node of old?.nodes ?? []) node.remove();
            nodes.marks.set(mark.key, entry);
          }
          place(entry);
        },
      );
    }
    // Nodes of geometry and grid lines no longer drawn go.
    for (const map of [nodes.marks, nodes.grids])
      for (const [key, entry] of map) {
        if (seen.has(entry)) continue;
        for (const node of entry.nodes) node.remove();
        map.delete(key);
      }
  }

  /** A new, empty clip path of id `id`. */
  #clipPath(id: string): SVGClipPathElement {
    const clip = element(this.#document, "clipPath", { id });
    this.#defs.append(clip);
    return clip;
  }

  /** Updates elements in place; a different kind or set of elements starts from fresh nodes. */
  #updateElements(old: Retained | undefined, kind: string, elements: SvgElement[]): Retained {
    const reuse =
      old?.hash === undefined &&
      old?.kind === kind &&
      old.nodes.length === elements.length &&
      old.nodes.every((node, i) => node.tagName === elements[i]!.tag);
    const entry: Retained = reuse
      ? old
      : {
          kind,
          nodes: elements.map(({ tag }) =>
            element(this.#document, tag as keyof SVGElementTagNameMap, { "data-kind": kind }),
          ),
          hash: undefined,
          names: elements.map(() => []),
        };
    elements.forEach(({ attributes }, i) => {
      const node = entry.nodes[i]!;
      const names = Object.keys(attributes);
      for (const name of entry.names[i]!) if (!(name in attributes)) node.removeAttribute(name);
      for (const name of names) set(node, name, attributes[name]!);
      entry.names[i] = names;
      // The layer's own attribute: drawings cannot change or remove it.
      set(node, "data-kind", kind);
    });
    return entry;
  }

  /** Rewrites a group's markup when it changes. */
  #updateMarkup(old: Retained | undefined, kind: string, markup: string): Retained {
    const reuse = old?.hash !== undefined && old.kind === kind;
    const entry: Retained = reuse
      ? old
      : { kind, nodes: [element(this.#document, "g", { "data-kind": kind })], hash: -1, names: [] };
    const markupHash = hash(markup);
    if (markupHash !== entry.hash) {
      entry.nodes[0]!.innerHTML = markup;
      entry.hash = markupHash;
    }
    return entry;
  }
}

/** Places `node` right after `previous` (first when null), keeping document order equal to paint order. */
function keepOrder(parent: Element, node: Element, previous: Element | null): Element {
  const expected = previous ? previous.nextSibling : parent.firstChild;
  if (node !== expected) parent.insertBefore(node, expected);
  return node;
}

export { element as svgElement };
