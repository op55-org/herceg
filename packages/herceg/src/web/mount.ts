// Charts in page fragments: a host element (`data-herceg`, as Python's
// `herceg.web.fragment` writes it) holding a payload or naming one to fetch,
// mounted once, its chart drawn into a `data-herceg-runtime` element of its
// own, and what the user does told to the page as DOM events.

import { type Chart, type ChartOptions, createChart } from "../dom/chart.ts";
import { showFailure } from "../dom/errors.ts";
import { ChartError, type ChartErrorInfo, chartError, errorInfo } from "../spec/errors.ts";
import { loadSpec } from "../spec/load.ts";
import {
  type InspectionPayload,
  inspectionPayload,
  type SelectionPayload,
  selectionPayload,
  type ViewportPayload,
  viewportPayload,
} from "./events.ts";
import { loadPayload, type PayloadSource } from "./load.ts";
import { readInline } from "./payload.ts";

/**
 * What a host's events carry, by name. They bubble, cross shadow roots,
 * and hold JSON: the host's `id`, and for a subplot's or panel's change,
 * the panels it is in.
 */
export interface HercegEventMap {
  /** The chart drew its first frame. */
  "herceg:ready": { id: string };
  /**
   * The chart cannot draw: its payload could not be loaded or read, or the
   * engine refused it. Cancelable: `preventDefault()` keeps it out of the
   * console. The host shows it either way.
   */
  "herceg:error": { id: string; error: ChartErrorInfo };
  /** The plot was clicked: the data under the pointer, or null off the data. */
  "herceg:click": { id: string; panel?: string; inspection: InspectionPayload | null };
  /** The selection changed; null when it was cleared. */
  "herceg:select": { id: string; panels?: string[]; selection: SelectionPayload | null };
  /** The view changed: each axis' range, null where it is not zoomed. */
  "herceg:viewport": { id: string; panels?: string[]; viewport: ViewportPayload };
}

/** The events, as `addEventListener` types their listeners. */
type HercegEvents = { [K in keyof HercegEventMap]: CustomEvent<HercegEventMap[K]> };

declare global {
  // They bubble from the host to the document and the window.
  interface HTMLElementEventMap extends HercegEvents {}
  interface DocumentEventMap extends HercegEvents {}
  interface WindowEventMap extends HercegEvents {}
}

interface Mounted {
  readonly controller: AbortController;
  /** What the runtime adds to the host, and removes on unmount. */
  readonly runtime: HTMLDivElement;
  chart: Chart | undefined;
  readonly done: Promise<Chart>;
}

const mounts = new WeakMap<Element, Mounted>();

/**
 * Mounts the chart of `host`: from `src` (a URL or a payload's bytes) when
 * given, else from the URL the host names (`data-herceg-src`), else from
 * the payload it holds. Resolves with the chart once its first frame is
 * drawn; rejects with the `ChartError` it shows in the host when it cannot
 * draw, and with an `AbortError` when unmounted first. A host is mounted
 * once: calling again returns the same promise until `unmount`.
 */
export function mount(host: HTMLElement, options: { src?: PayloadSource } = {}): Promise<Chart> {
  const current = mounts.get(host);
  if (current) return current.done;
  // What a runtime left in markup the page restored (from history, say) goes.
  for (const stale of host.querySelectorAll(":scope > [data-herceg-runtime]")) stale.remove();
  // The size the fragment reserved with a style element moves to the host's own style.
  host.querySelector(":scope > style[data-herceg-style]")?.remove();
  const { hercegWidth: width, hercegHeight: height } = host.dataset;
  host.style.width = width ? `${width}px` : "100%";
  if (height) host.style.height = `${height}px`;
  const runtime = host.ownerDocument.createElement("div");
  runtime.setAttribute("data-herceg-runtime", "");
  runtime.style.cssText = "width:100%;height:100%";
  host.append(runtime);
  const controller = new AbortController();
  const done = start(host, runtime, controller.signal, options.src, (chart) => {
    mounted.chart = chart;
  });
  const mounted: Mounted = { controller, runtime, chart: undefined, done };
  mounts.set(host, mounted);
  // The host shows and tells of a failure; unread, it is no unhandled rejection.
  done.catch(() => {});
  return done;
}

/**
 * Destroys the chart of `host`, if mounted, and removes what mounting
 * added: a fetch still under way is aborted, and the chart leaves its sync
 * groups. The host can be mounted again.
 */
export function unmount(host: Element): void {
  const mounted = mounts.get(host);
  if (!mounted) return;
  mounts.delete(host);
  mounted.controller.abort();
  mounted.chart?.destroy();
  mounted.runtime.remove();
  host.querySelector(":scope > [data-herceg-fallback]")?.removeAttribute("hidden");
}

/** The chart mounted in `host`, once made (its first frame may still be coming). */
export function getChart(host: Element): Chart | undefined {
  return mounts.get(host)?.chart;
}

/** Whether `host` is mounted, or mounting. */
export function isMounted(host: Element): boolean {
  return mounts.has(host);
}

/**
 * Whether what mounting added to `host` was taken out of it while it stayed:
 * its content was replaced (an HTMX `innerHTML` swap, a restore from history).
 */
export function emptied(host: Element): boolean {
  const mounted = mounts.get(host);
  return mounted !== undefined && mounted.runtime.parentNode !== host;
}

/** Loads and draws the chart of `host` in `runtime`, handing it to `made` once made. */
async function start(
  host: HTMLElement,
  runtime: HTMLElement,
  signal: AbortSignal,
  src: PayloadSource | undefined,
  made: (chart: Chart) => void,
): Promise<Chart> {
  const id = host.id;
  let options: ChartOptions;
  try {
    options = await optionsOf(host, src, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    // Errors of loading and of the spec come with their phase.
    const failure = error instanceof ChartError ? error : chartError(error, "load");
    hideFallback(host);
    const { width, height } = host.getBoundingClientRect();
    showFailure(runtime, failure, false, { width: width || 640, height: height || 320 });
    report(host, failure);
    throw failure;
  }
  if (signal.aborted) throw signal.reason;
  hideFallback(host);
  const chart = createChart(runtime, {
    ...options,
    // Each failure once, whether it also rejects `ready` or comes later.
    onError: (error) => report(host, error),
  });
  // A listener of an error the chart met as it was made may have unmounted the host.
  if (signal.aborted) {
    chart.destroy();
    throw signal.reason;
  }
  made(chart);
  chart.on("click", ({ inspection }) =>
    dispatch(host, "herceg:click", {
      id,
      ...(inspection?.panel !== undefined && { panel: inspection.panel }),
      inspection: inspectionPayload(chart, inspection),
    }),
  );
  chart.on("select", (selection) =>
    dispatch(host, "herceg:select", {
      id,
      ...(selection.panels && { panels: [...selection.panels] }),
      selection: selectionPayload(chart, selection, selection.panels),
    }),
  );
  chart.on("viewport", (viewport) =>
    dispatch(host, "herceg:viewport", {
      id,
      ...(viewport.panels && { panels: [...viewport.panels] }),
      // Panels a change names share the scale: the first one's axes read it.
      viewport: viewportPayload(chart, viewport, false, viewport.panels?.[0]),
    }),
  );
  // A destroyed chart's `ready` never settles: unmounting settles this. An
  // unmount just after the first frame finds `ready` settled, so ask again.
  await Promise.race([chart.ready, aborted(signal)]);
  if (signal.aborted) throw signal.reason;
  dispatch(host, "herceg:ready", { id });
  return chart;
}

/** The chart options of the host's payload: given, fetched, or held as JSON. */
async function optionsOf(
  host: HTMLElement,
  src: PayloadSource | undefined,
  signal: AbortSignal,
): Promise<ChartOptions> {
  const url = src ?? host.dataset.hercegSrc;
  if (url !== undefined) return loadPayload(url, { signal });
  const template = host.querySelector<HTMLTemplateElement>(
    ":scope > template[data-herceg-payload]",
  );
  if (!template)
    throw new ChartError({
      code: "load-failed",
      phase: "load",
      message: `fragment ${JSON.stringify(host.id)}: it holds no payload and names none to fetch; make it with herceg.web.fragment(chart)`,
    });
  const { spec, buffers } = readInline(template.content.textContent ?? "");
  try {
    return loadSpec(spec, buffers).config;
  } catch (error) {
    throw chartError(error, "validate");
  }
}

function hideFallback(host: HTMLElement) {
  host.querySelector(":scope > [data-herceg-fallback]")?.setAttribute("hidden", "");
}

/** Tells the page of a failure; the console hears of it unless a listener prevents that. */
function report(host: HTMLElement, error: ChartError) {
  if (dispatch(host, "herceg:error", { id: host.id, error: errorInfo(error) }))
    console.error(error);
}

/** Dispatches a host's event; false when a listener canceled it. */
function dispatch<K extends keyof HercegEventMap>(
  host: HTMLElement,
  type: K,
  detail: HercegEventMap[K],
): boolean {
  return host.dispatchEvent(
    new CustomEvent(type, {
      detail,
      bubbles: true,
      composed: true,
      cancelable: type === "herceg:error",
    }),
  );
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
