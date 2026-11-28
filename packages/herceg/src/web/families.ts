// The code a page's specs draw with, loaded as they need it: herceg/web
// carries series and annotations, and imports the families of other marks
// (custom shapes, distributions, matrices, layouts, networks, maps, 3D) and
// of spec features (tables made from tables, row selection and its
// lineage, facets and subplots, navigators, time breaks) when a spec it
// loads names them, each once per page however many charts need it. The
// spec then loads as `loadSpec` loads it (spec/load-with.ts).

import { contributorsOf } from "../data/contributor-records.ts";
import type { Table } from "../data/table.ts";
import { ChartError, chartError } from "../spec/errors.ts";
import { SERIES } from "../spec/families/series.ts";
import {
  checkUnknown,
  type LoadedSpec,
  type LoadKit,
  type LoadOptions,
  loadWith,
  type MarkFactories,
  type SpecBuffer,
} from "../spec/load-with.ts";
import type { ChartSpec, MarkSpec } from "../spec/spec.ts";

/** Each family's import: what it gives the loader. */
const IMPORTS = {
  shapes: () => import("../spec/families/shapes.ts").then((family) => family.SHAPES),
  distributions: () =>
    import("../spec/families/distributions.ts").then((family) => family.DISTRIBUTIONS),
  matrix: () => import("../spec/families/matrix.ts").then((family) => family.MATRIX),
  layouts: () => import("../spec/families/layouts.ts").then((family) => family.LAYOUTS),
  networks: () => import("../spec/families/networks.ts").then((family) => family.NETWORKS),
  maps: () => import("../spec/families/maps.ts").then((family) => family.MAPS),
  "three-d": () => import("../spec/families/three-d.ts").then((family) => family.THREE_D),
  tables: () => import("../spec/features/tables.ts"),
  selection: () => import("../spec/features/selection.ts"),
  lineage: () => import("../model/lineage-kit.ts").then((module) => module.lineage),
  panels: () => import("../spec/features/panels.ts"),
  navigator: () => import("../model/navigator.ts").then((module) => module.rangeNavigator),
  breaks: () => import("../scale/breaks.ts").then((module) => module.timeBreaks),
};

/** A family of code a spec can need, which herceg/web loads when one does. */
export type Family = keyof typeof IMPORTS;

type Parts = { [F in Family]: Awaited<ReturnType<(typeof IMPORTS)[F]>> };

type MarkFamily =
  | "shapes"
  | "distributions"
  | "matrix"
  | "layouts"
  | "networks"
  | "maps"
  | "three-d";

/** The family of each mark type herceg/web does not carry. */
const FAMILY_OF: Record<Exclude<MarkSpec["type"], keyof typeof SERIES>, MarkFamily> = {
  segment: "shapes",
  histogram: "distributions",
  boxplot: "distributions",
  boxen: "distributions",
  violin: "distributions",
  heatmap: "matrix",
  contour: "matrix",
  dendrogram: "matrix",
  pie: "layouts",
  funnel: "layouts",
  gauge: "layouts",
  radar: "layouts",
  treemap: "layouts",
  sunburst: "layouts",
  sankey: "layouts",
  graph: "networks",
  geoshape: "maps",
  geopoint: "maps",
  point3d: "three-d",
  line3d: "three-d",
  surface: "three-d",
};

const MARK_FAMILIES = [...new Set(Object.values(FAMILY_OF))];

/** Families imported, or importing: one import each per page, until one fails. */
const loading = new Map<Family, Promise<unknown>>();
/** What the families imported give, for specs that need nothing more. */
const loaded: Partial<Parts> = {};
/** How a family is imported: `load`, its own import, unless a test says otherwise. */
type Importer = (family: Family, load: () => Promise<unknown>) => Promise<unknown>;
let importFamily: Importer = (_, load) => load();

/**
 * Forgets the families imported, so that the next spec imports what it
 * needs as the first on a page does, through `importer` (given each
 * family's own import): for this package's tests of loading.
 */
export function forgetFamilies(importer: Importer = (_, load) => load()): void {
  loading.clear();
  for (const family of Object.keys(loaded) as Family[]) delete loaded[family];
  importFamily = importer;
}

/**
 * Loads `spec` as `loadSpec` does, once the code of the marks and features
 * it names is in: checked first, so a spec refused loads nothing. Rejects
 * with a ChartError, of phase "validate" for a spec the engine refuses and
 * "load" for code that could not load, and with the signal's reason when
 * it aborts first.
 */
export async function loadSpecWithFamilies(
  spec: ChartSpec,
  buffers: readonly SpecBuffer[] = [],
  options: LoadOptions & { signal?: AbortSignal | undefined } = {},
): Promise<LoadedSpec> {
  const { signal, ...load } = options;
  let unknown: string[];
  try {
    unknown = checkUnknown(spec, load);
  } catch (error) {
    throw chartError(error, "validate");
  }
  const kit = await kitFor(spec, load, signal);
  signal?.throwIfAborted();
  try {
    return loadWith(kit, spec, buffers, load, unknown);
  } catch (error) {
    throw chartError(error, "validate");
  }
}

/** The kit of what `spec` names, its families imported first where they are not yet. */
async function kitFor(
  spec: ChartSpec,
  options: LoadOptions,
  signal: AbortSignal | undefined,
): Promise<LoadKit> {
  // A chart already gone starts no imports.
  signal?.throwIfAborted();
  const needed = familiesOf(spec, options);
  const pending = [...needed].flatMap(([family, what]) =>
    family in loaded
      ? []
      : [importOnce(family).catch((error) => Promise.reject(failed(what, error)))],
  );
  if (pending.length > 0) await abortable(Promise.all(pending), signal);
  // Only what the spec names: a spec loads alike whatever others loaded before it.
  const part = <F extends Family>(family: F) => (needed.has(family) ? loaded[family] : undefined);
  const marks: MarkFactories = { ...SERIES };
  for (const family of MARK_FAMILIES) Object.assign(marks, part(family));
  return {
    marks,
    tables: part("tables"),
    selection: part("selection"),
    lineage: part("lineage"),
    panels: part("panels"),
    navigator: part("navigator"),
    breaks: part("breaks"),
  };
}

/**
 * The families `spec` needs beyond what herceg/web carries, each with what
 * of the spec needs it first, as a failure names it. Mark types the format
 * lacks need none: checking the spec refused them.
 */
export function familiesOf(spec: ChartSpec, options: LoadOptions = {}): Map<Family, string> {
  const needed = new Map<Family, string>();
  const need = (family: Family, what: string) => {
    if (!needed.has(family)) needed.set(family, what);
  };
  for (const { type } of spec.marks)
    if (Object.hasOwn(FAMILY_OF, type))
      need(FAMILY_OF[type as keyof typeof FAMILY_OF], `"${type}" marks`);
  const data = Object.entries(spec.data ?? {});
  // Views, derived tables, groups, and totals are made from a source.
  const made = data.find(([, entry]) => "source" in entry);
  if (made) need("tables", `data.${made[0]}`);
  // Views following a store's channels, and bindings, hold selection stores.
  const following = data.find(([, entry]) => "view" in entry && entry.view.selection);
  if (following) need("selection", `data.${following[0]}.view.selection`);
  if ([spec.rowSelection ?? []].flat().length > 0) {
    need("selection", "rowSelection");
    // Only derived tables, groups, and totals record the rows they come from,
    // so only marks of them, or of tables given that do, route through lineage.
    const given = options.tables;
    const tables: Iterable<Table> =
      given === undefined ? [] : given instanceof Map ? given.values() : Object.values(given);
    if (
      data.some(([, entry]) => "source" in entry && !("view" in entry)) ||
      [...tables].some((table) => contributorsOf(table) !== undefined)
    )
      need("lineage", "rowSelection's lineage");
  }
  if (spec.facet) need("panels", "facet");
  else if (spec.panels) need("panels", "panels");
  if (spec.navigator) need("navigator", "navigator");
  if (spec.x?.breaks) need("breaks", "x.breaks");
  return needed;
}

/** Imports `family` once per page; a failed import is forgotten, so a later spec tries again. */
function importOnce(family: Family): Promise<unknown> {
  let importing = loading.get(family);
  if (!importing) {
    importing = importFamily(family, IMPORTS[family]).then(
      (part) => {
        Object.assign(loaded, { [family]: part });
        return part;
      },
      (error: unknown) => {
        // Browsers that keep a failed module's result reject it until the page reloads.
        loading.delete(family);
        throw error;
      },
    );
    loading.set(family, importing);
  }
  return importing;
}

/** Why a spec's chart cannot draw: the code of `what` it names did not load. */
function failed(what: string, error: unknown): ChartError {
  const reason = error instanceof Error ? error.message : String(error);
  return new ChartError(
    {
      code: "load-failed",
      phase: "load",
      message: `payload: the code of ${what} could not load (${reason}); check that the page serves every file of herceg's assets`,
    },
    error,
  );
}

/**
 * `promise`, or the signal's reason as soon as it aborts. It handles
 * `promise` either way, so a failure after the abort is not left unhandled.
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
