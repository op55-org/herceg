// What a custom mark's `encode` gives its `draw`: each channel's output for
// a row and, where `draw` names it, a series (`DataDrawContext.encoded`),
// compiled as every mark's channels are (channels.ts), read per table
// version, theme, and what channels read beyond the row (channel scales'
// domains, ranks); and the colors a color channel gives series (a
// constant, the series field's values, or the series' names through a
// scale, alone or ending a list).

import type { MarkRows } from "../../data/row-view.ts";
import type { Table } from "../../data/table.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { ChannelName } from "../../spec/channels.ts";
import type { EncodingsSpec } from "../../spec/encoding.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { CustomSeries } from "../custom.ts";
import type { GlyphKey } from "../mark.ts";
import {
  type Channel,
  type Check,
  channelRevision,
  compileChannel,
  displayFields,
  outputCheck,
  type RowReader,
  rowReader,
  type ScaleOf,
  seriesTail,
} from "./channels.ts";
import { categoryKey, keyedFields } from "./row-styles.ts";

/** The channels a custom mark's `draw` reads. */
const CHANNELS = ["color", "strokeWidth", "opacity"] as const;
type Name = (typeof CHANNELS)[number];

interface Compiled {
  /** What a series' rows read: the channel, or a list but the entry ending it that colors the series. */
  readonly channel: Channel<unknown> | undefined;
  /** That entry: the series' names, or the series field, which a series' rows without another output take. */
  readonly tail: Channel<unknown> | undefined;
  /** The channel as given, which rows read without their series read whole. */
  readonly whole: Channel<unknown>;
  readonly check: Check;
  readonly path: string;
  /** Rows of `channel` (`read`) and of `whole` (`alone`) as last read, and what they were read at. */
  read?: Read;
  alone?: Read;
}

interface Read {
  readonly version: number;
  readonly scaled: number;
  readonly theme: Theme | undefined;
  readonly rows: RowReader<unknown>;
}

/** A custom mark's channels, compiled against its table (`path` names the mark in messages). */
export function encodedChannels(
  kit: FeatureKit,
  encode: Pick<EncodingsSpec, Name> | undefined,
  table: Table,
  series: string | undefined,
  scales: ScaleOf,
  path: string,
): {
  use(theme: Theme, paint: PaintReader): void;
  encoded(channel: Name, row: number, series?: CustomSeries): string | number | undefined;
  seriesColor(name: string, label: string | undefined): string | undefined;
  keys(rows: MarkRows): GlyphKey[];
  /** Whether `keys` gives keys where rows are drawn: a color list reads a scale of categories. */
  hasKeys: boolean;
  /** The number fields whose display colors a color list reads, which the chart's legends key. */
  displayColors: string[] | undefined;
} {
  const compiled = new Map<Name, Compiled>();
  for (const name of CHANNELS) {
    const given = encode?.[name];
    if (!given) continue;
    const at = `${path} encode.${name}`;
    // Series' outputs are read as the series' colors; draw reads widths and opacities by row.
    if (name !== "color")
      for (const [i, c] of (Array.isArray(given) ? given : [given]).entries())
        if ("series" in c)
          throw new TypeError(
            `${at}${Array.isArray(given) ? `[${i}]` : ""}: the series' names give each series one ${name}, and draw reads it by row; give a field, a value, or a condition`,
          );
    const check = outputCheck(name as ChannelName, kit.isColor);
    const read = compileChannel(given as never, table, scales, name, check, at, name);
    // Only colors end in the series' (widths and opacities refuse its names; a field of the series' is read by row).
    const [channel, tail] = name === "color" ? seriesTail(read, series) : [read, undefined];
    compiled.set(name, { channel, tail, whole: read, check, path: at });
  }
  let theme: Theme | undefined;
  let paint: PaintReader = (value) => value;
  const listed = compiled.get("color")?.channel;
  const shown = listed?.kind === "list" ? displayFields(listed) : [];
  return {
    displayColors: shown.length > 0 ? shown : undefined,
    hasKeys: listed?.kind === "list" && keyedFields(listed as Channel<string>, series).length > 0,
    use(t, p) {
      theme = t;
      paint = p;
    },
    encoded(name, row, series) {
      const c = compiled.get(name);
      if (!c) return undefined;
      // A series' rows without another output take its color; rows read
      // alone read the channel whole (the series' names give them none,
      // the series field its value's color).
      const named = c.tail ?? (c.channel?.kind === "series" ? c.channel : undefined);
      if (series && (!c.channel || c.channel === named)) return named && series.color;
      const channel = series ? c.channel! : c.whole;
      const scaled = channelRevision([channel]);
      const slot = series ? "read" : "alone";
      let read = c[slot];
      if (read?.version !== table.version || read.scaled !== scaled || read.theme !== theme) {
        const colors = name === "color";
        read = {
          version: table.version,
          scaled,
          theme,
          rows: rowReader(
            channel,
            table,
            colors ? (theme?.palette ?? []) : [],
            (colors ? (theme?.muted ?? "#999999") : undefined) as unknown,
            c.check,
            c.path,
            false,
          ),
        };
        c[slot] = read;
      }
      const out = read.rows.output(row) as string | number | undefined;
      return out === undefined && series && c.tail ? series.color : out;
    },
    seriesColor(name, label) {
      const color = compiled.get("color");
      const channel = (color?.tail ?? color?.channel) as Channel<string> | undefined;
      if (!channel || !theme) return undefined;
      if (channel.kind === "value") return channel.value;
      if (channel.kind === "series")
        return channel.scale.output(label ?? name, theme.palette, theme.muted);
      if (channel.kind === "field" && channel.field === series)
        return channel.scale.output(name, theme.palette, theme.muted);
      return undefined;
    },
    keys(rows) {
      // Scales a color list reads key their values (a field alone does not, as before lists).
      const color = compiled.get("color");
      if (color?.channel?.kind !== "list") return [];
      return keyedFields(color.channel as Channel<string>, series).flatMap(
        (field) => categoryKey(field, rows, theme, paint, color.path, undefined) ?? [],
      );
    },
  };
}
