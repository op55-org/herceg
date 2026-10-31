// Legends of subplots: what each panel draws, what the legends of a panel
// list there (which the chart's legend leaves to them), and how entries
// look where panels show or hide series of their own. Loaded with subplots
// (model/panels.ts), which hand it to the guide compiler's legends.

import type { ChartMark, Mark, RowParts } from "../marks/mark.ts";
import { ChartError } from "../spec/errors.ts";
import type { PaintReader, Theme } from "../theme.ts";
import {
  HiddenKeys,
  type LegendContent,
  type LegendEntry,
  type LegendPart,
  wholeOf,
} from "./legend.ts";

/** A mark, by its id or index, and the channel of a scale it owns. */
type Owned = readonly { mark: string | number; channel: string }[];

/** The marks owning each legend part (see `partOwners` in guides/legends.ts). */
export type PartOwners = ReadonlyMap<string, { owners: Owned }>;

/** What a panel of subplots draws, as its legends list it. */
interface PanelTargets {
  /** The keys of its series (or a layout mark's items), by their entries' keys. */
  members: Map<string, string[]>;
  /**
   * What each entry toggles there, by its key: what its series stand for,
   * or a series' own key where it stands for nothing (the entry's key).
   */
  targets: Map<string, readonly string[]>;
  /** The marks drawing each entry's series there. */
  marks: Map<string, (string | number)[]>;
  /** Every mark drawn there but marks of every panel, which are the chart's legend's alone. */
  drawn: Set<string | number>;
  /** The keys of the legend parts (a map's color ramp) of the layout mark drawn there. */
  parts: Set<string>;
  /** The entries of the layout mark drawn there, under their identities' keys, for swatches. */
  also: LegendEntry[];
  /** Whether a layout mark's items are what it draws. */
  items: boolean;
}

/**
 * What hiding (or showing, `visible`) series and items `keys` makes of
 * what panels' legends set (`hidden.panels`): in `panel`, its own state
 * of them (what a key stands for in place of its series' own settings);
 * in every panel, without one, they let go of what they set of the keys
 * and of what those stand for. `hidden.panels` itself where nothing
 * changes.
 */
export function panelVisibility(
  hidden: HiddenKeys,
  keys: readonly string[],
  visible: boolean,
  panel: string | undefined,
): Map<string, Map<string, boolean>> {
  const { groups } = hidden;
  let changed = false;
  // Marks given whole, whose series' settings follow (read through every series only then).
  const wholes = keys.some((key) => key.startsWith('{"mark":') && wholeOf(key) === undefined);
  if (panel !== undefined) {
    const own = new Map(hidden.panels.get(panel));
    // Settings of what keys stand for, or of a mark whole, replace their
    // series' and rows' own.
    const given = new Set(keys);
    for (const key of own.keys())
      if (given.has(groups.get(key)!) || given.has(wholeOf(key)!)) {
        own.delete(key);
        changed = true;
      }
    for (const key of keys) {
      if (own.get(key) !== !visible) changed = true;
      own.set(key, !visible);
    }
    // A mark's series the panel shows or hides through what they stand
    // for take the state the mark is given whole.
    if (wholes)
      for (const [series, group] of groups)
        if (own.has(group) && given.has(wholeOf(series)!) && own.get(series) !== !visible) {
          own.set(series, !visible);
          changed = true;
        }
    return changed ? new Map(hidden.panels).set(panel, own) : hidden.panels;
  }
  const identity = (key: string) => groups.get(key) ?? key;
  const given = new Set(keys.map(identity));
  const out = new Map<string, Map<string, boolean>>();
  for (const [name, own] of hidden.panels) {
    // Panels let go of what they set of the keys, what those stand for,
    // and a mark's series and rows where the mark is given whole; series
    // of the mark a panel shows or hides through what they stand for
    // take its state.
    const kept = new Map(
      [...own].filter(([key]) => !given.has(identity(key)) && !given.has(wholeOf(key)!)),
    );
    if (wholes)
      for (const [series, group] of groups)
        if (own.has(group) && given.has(wholeOf(series)!)) kept.set(series, !visible);
    if (kept.size !== own.size || [...kept].some(([key, hide]) => own.get(key) !== hide))
      changed = true;
    if (kept.size > 0) out.set(name, kept);
  }
  return changed ? out : hidden.panels;
}

/** The legends of one scene of a chart of subplots. */
export class PanelLegends {
  readonly #panels = new Map<string, PanelTargets>();
  /** The marks drawing each entry's series, and those owning each part, in any panel. */
  readonly #owners: ReadonlyMap<string, readonly (string | number)[]>;
  readonly #partsOf: PartOwners;
  /** Marks of every panel, which follow the chart's visibility in each. */
  readonly #everywhere: ReadonlySet<string | number>;
  /** What panels' legends list, by panel. */
  readonly #covered = new Map<string, Set<string>>();

  constructor(
    content: LegendContent,
    owners: ReadonlyMap<string, readonly (string | number)[]>,
    partsOf: PartOwners,
    theme: Theme,
    locale: string | undefined,
    paint: PaintReader,
    named: ReadonlySet<string | number>,
    /** An annotation's entries by its label, of its rows in a panel. */
    labelEntries: (mark: Mark, rows: RowParts | undefined) => { key: string }[],
  ) {
    this.#owners = owners;
    this.#partsOf = partsOf;
    const { split, color } = content;
    const groups = content.hidden.groups;
    const everywhere = new Set<string | number>();
    split?.keys.forEach((key, p) => {
      const members = new Map<string, string[]>();
      const targets = new Map<string, readonly string[]>();
      const marks = new Map<string, (string | number)[]>();
      const drawn = new Set<string | number>();
      const parts = new Set<string>();
      const also: LegendEntry[] = [];
      // An entry toggles what its series stand for, where they stand for
      // something, in the panel, as the chart's toggle it in the chart:
      // their identity's key, which another spec of the same values keeps.
      const add = (entry: string, key: string, mark: string | number) => {
        const list = members.get(entry);
        if (list) list.push(key);
        else members.set(entry, [key]);
        targets.set(entry, [entry]);
        own(entry, mark);
      };
      const own = (entry: string, mark: string | number) => {
        const owners = marks.get(entry) ?? [];
        if (!owners.includes(mark)) marks.set(entry, [...owners, mark]);
      };
      // The values of the declared domains a mark reads, drawn or not, which
      // it owns beside those drawing them.
      const domains = (mark: ChartMark, owner: string | number) => {
        for (const key of content.features?.domainKeys(mark) ?? [])
          if (targets.has(key)) own(key, owner);
          else add(key, key, owner);
      };
      const item = split.items?.[p];
      if (item && color) {
        // Its items' keys take its id or its place in the chart. As an
        // owner, beside marks along axes (known by their ids, or their
        // places among those from 0), an unnamed one goes by a negative
        // number, which no id or place is.
        const id = item.mark.spec.id ?? item.index;
        const owner = item.mark.spec.id ?? -1 - item.index;
        drawn.add(owner);
        for (const entry of item.mark.legend(id, color, theme, paint)) {
          const identity = groups?.get(entry.key) ?? entry.key;
          add(identity, entry.key, owner);
          also.push({ ...entry, key: identity });
        }
        for (const part of item.mark.legends?.(theme, locale, paint) ?? []) parts.add(part.key);
        domains(item.mark, owner);
      } else
        split.panels[p]!.forEach(({ mark, series, rows }, m) => {
          const id = mark.spec.id ?? m;
          // Marks of every panel are the chart's legend's alone.
          if (mark.spec.panel === "*") everywhere.add(id);
          if (split.members?.[p]?.[m] === false || mark.spec.panel === "*") return;
          if (mark.labelEntries) {
            // Annotations listed by their labels: what their rows drawn here name.
            if (mark.spec.legend !== true && !named.has(id)) return;
            drawn.add(id);
            for (const { key } of labelEntries(mark, rows)) add(key, key, id);
            return;
          }
          // Marks left out of legends are listed where a legend names them.
          if (mark.spec.legend === false && !named.has(id)) return;
          drawn.add(id);
          for (const s of series) add(s.entry ?? s.key, s.key, id);
          domains(mark, id);
        });
      this.#panels.set(key, {
        members,
        targets,
        marks,
        drawn,
        parts,
        also,
        items: !!(item && color),
      });
    });
    this.#everywhere = everywhere;
  }

  /**
   * What is hidden once a legend shows `keys`, in panel `panel` or in the
   * chart, as `setVisibility` leaves it.
   */
  static showing(
    hidden: HiddenKeys,
    keys: readonly string[],
    panel: string | undefined,
  ): HiddenKeys {
    // What series stand for, shared: showing changes none of it.
    const { groups } = hidden;
    const next = Object.assign(new HiddenKeys(), { groups });
    const identity = (key: string) => groups.get(key) ?? key;
    const gone = new Set(panel === undefined ? keys.map(identity) : []);
    for (const key of hidden) if (!gone.has(identity(key))) next.add(identity(key));
    next.panels = panelVisibility(hidden, keys, true, panel);
    return next;
  }

  /** Throws unless the chart has panel `panel`, which the legend at `path` names. */
  check(panel: string, path: string): void {
    if (this.#panels.has(panel)) return;
    throw new ChartError({
      code: "unknown-reference",
      path: `${path}.panel`,
      message: `${path}.panel: no panel "${panel}"; name one of ${[...this.#panels.keys()].map((key) => `"${key}"`).join(", ")}`,
    });
  }

  /**
   * What the legend of panel `panel` lists: the entries of what the panel
   * draws, and of `parts` those of the marks drawn there, that `shows`
   * keeps of the scales their marks own; which the chart's legend then
   * leaves to it there. A legend of entries of its own (`custom`, the keys
   * they target) covers those whose every series there it targets: by
   * their key, what they stand for, or their mark whole.
   */
  listed(
    panel: string,
    entries: readonly LegendEntry[],
    parts: readonly LegendPart[],
    shows: (owned: Owned, key: string) => boolean,
    custom?: ReadonlySet<string>,
  ): { entries: LegendEntry[]; parts: LegendPart[] } {
    const own = this.#panels.get(panel)!;
    const listed = {
      entries: entries.filter(
        ({ key }) =>
          own.targets.has(key) &&
          shows(
            own.marks.get(key)!.map((mark) => ({ mark, channel: "series" })),
            key,
          ) &&
          (!custom ||
            custom.has(key) ||
            own.members
              .get(key)!
              .every((series) => custom.has(series) || custom.has(wholeOf(series) ?? series))),
      ),
      parts: parts.filter(
        ({ key }) =>
          own.parts.has(key) ||
          !!this.#partsOf.get(key)?.owners.some(({ mark }) => own.drawn.has(mark)),
      ),
    };
    const covered = this.#covered.get(panel) ?? new Set<string>();
    for (const { key } of [...listed.entries, ...listed.parts]) covered.add(key);
    this.#covered.set(panel, covered);
    return listed;
  }

  /**
   * Of the chart's legend's entries and parts, those the legends of panels
   * leave to it: drawn in no panel, by a mark of every panel, or in a panel
   * whose legends do not list them.
   */
  uncovered(
    entries: readonly LegendEntry[],
    parts: readonly LegendPart[],
  ): { entries: LegendEntry[]; parts: LegendPart[] } {
    if (this.#covered.size === 0) return { entries: [...entries], parts: [...parts] };
    const left = (
      key: string,
      owners: readonly (string | number)[] | undefined,
      inPanel: (panel: PanelTargets) => boolean,
    ) => {
      const drawnIn = [...this.#panels].filter(([, drawn]) => inPanel(drawn));
      return (
        drawnIn.length === 0 ||
        !!owners?.some((mark) => this.#everywhere.has(mark)) ||
        drawnIn.some(([panel]) => !this.#covered.get(panel)?.has(key))
      );
    };
    return {
      entries: entries.filter(({ key }) =>
        left(key, this.#owners.get(key), (p) => p.targets.has(key)),
      ),
      parts: parts.filter(({ key }) => {
        const marks = this.#partsOf.get(key)?.owners.map(({ mark }) => mark) ?? [];
        return left(key, marks, (p) => p.parts.has(key) || marks.some((mark) => p.drawn.has(mark)));
      }),
    };
  }

  /**
   * How panel `panel`'s legend toggles its entries: what each names there
   * (`targets`), and the marks drawn there, whose looks its swatches draw.
   */
  shown(panel: string): {
    targets: ReadonlyMap<string, readonly string[]>;
    drawn: ReadonlySet<string | number>;
    also: readonly LegendEntry[];
  } {
    const own = this.#panels.get(panel)!;
    return { targets: own.targets, drawn: own.drawn, also: own.also };
  }

  /** Each layout mark's items drawn in a panel: the panel, their identity's key, and their own keys. */
  *items(): Generator<[panel: string, identity: string, keys: readonly string[]]> {
    for (const [panel, { members, items }] of this.#panels)
      if (items) for (const [identity, keys] of members) yield [panel, identity, keys];
  }
}
