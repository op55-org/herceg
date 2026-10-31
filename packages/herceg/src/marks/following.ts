// Text following another mark's series (`text({ from })`, marks/attachments.ts):
// a label for each series of a line or area declared before it, at the
// point `from.at` names, which the feature compiler places and draws as
// the source mark draws (marks/features/labels.ts). It has no table and no
// rows: its label's fields are the source mark's, read at the observation
// each label is at, and it counts toward no domain.

import type { LabelPlaceSpec } from "../spec/encoding.ts";
import { ChartError } from "../spec/errors.ts";
import type { Frozen, TextSpec } from "../spec/spec.ts";
import { checkOptionalItemKey, frozen, type MARK, type Mark } from "./mark.ts";

/** Options of text that labels series elsewhere, and what to do instead. */
const PLACED: readonly [option: keyof TextSpec, instead: string][] = [
  ["at", "drop at, or from"],
  ["x", "drop x and y, or from"],
  ["y", "drop x and y, or from"],
  ["axis", "labels follow their series on its axis; drop axis"],
  ["facet", "labels follow their series in each panel it is drawn in; drop facet"],
  ["contributeDomain", "labels follow where their series is drawn; drop contributeDomain"],
];

export class FollowingTextMark implements Mark<Frozen<TextSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<TextSpec>;
  readonly tooltip = "x";
  /** The feature compiler places its labels. */
  readonly featured = true;
  readonly roomPlaced = true;
  readonly table = undefined;

  constructor(input: TextSpec) {
    this.spec = frozen(input);
    const { spec } = this;
    for (const [option, instead] of PLACED)
      if (spec[option] !== undefined)
        refuse(option, `follows mark "${spec.from!.mark}"; ${instead}`);
    if (spec.legend === true)
      refuse("legend", "labels following series name what the legend lists already; drop legend");
    if (spec.label === undefined)
      refuse("label", "required; give its text, a field of the source mark, or content");
    // Its rows are the source mark's: it has none of its own to name.
    checkOptionalItemKey(undefined, spec.itemKey, "text");
    // Typed callers cannot give these; others are told why.
    const place: Frozen<LabelPlaceSpec> | undefined =
      typeof spec.label === "object" ? spec.label.place : undefined;
    for (const option of ["attachment", "side"] as const)
      if (place?.[option] !== undefined)
        refuse(`label.place.${option}`, `labels go at from.at on their series; drop ${option}`);
  }

  channelKind() {
    return undefined;
  }

  series() {
    return [];
  }

  xExtent() {
    return undefined;
  }

  yExtent() {
    return undefined;
  }

  /** Drawn with the chart's features (marks/features/labels.ts), where the source mark is drawn. */
  geometry() {
    return [];
  }

  room(...[, , , features]: Parameters<NonNullable<Mark["room"]>>): [number, number] {
    return features?.of(this)?.room?.() ?? [0, 0];
  }

  /** Nothing of its own: the series it labels are described already. */
  describe() {
    return undefined;
  }
}

function refuse(path: string, why: string): never {
  throw new ChartError({ code: "invalid-option", path, message: `text ${path}: ${why}` });
}
