// What a custom mark's `encode` gives its `draw`: each channel's output for
// a row and, where `draw` names it, a series (`DataDrawContext.encoded`),
// compiled as every mark's channels are (channels.ts), read per table
// version, theme, and what channels read beyond the row (channel scales'
// domains, ranks); and the colors a color channel gives series (a
// constant, the series field's values, or the series' names through a
// scale, alone or ending a list). Marks the custom mark's core draws
// (segments) read their own channels the same way, by the names they give.

import type { MarkRows } from "../../data/row-view.ts";
import type { ReadonlyTable, Table } from "../../data/table.ts";
import {
  type Channel,
  type Check,
  channelRevision,
  compileChannel,
  type RowReader,
  rowReader,
  type ScaleOf,
} from "../../encoding/channels.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { ChannelsSpec } from "../../spec/encoding.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { CustomSeries } from "../custom.ts";
import type { GlyphKey } from "../mark.ts";
import { displayFields, outputCheck, seriesTail } from "./channels.ts";
import { categoryKey, keyedFields } from "./row-styles.ts";

/**
 * A channel a mark's draw reads per row: the name it reads it by (a
 * color's is "color"), the output it gives (checked as that channel's
 * are), the channel as given, and where it is given, as messages name it
 * ("encode.color", "width.from").
 */
export interface DrawChannel {
  readonly name: string;
  readonly output: "color" | "strokeWidth" | "opacity";
  readonly given: ChannelsSpec<unknown>;
  readonly path: string;
}

interface Compiled {
  /** What a series' rows read: the channel, or a list but the entry ending it that colors the series. */
  readonly channel: Channel<unknown> | undefined;
  /** That entry: the series' names, or the series field, which a series' rows without another output take. */
  readonly tail: Channel<unknown> | undefined;
  /** The channel as given, which rows read without their series read whole. */
  readonly whole: Channel<unknown>;
  readonly check: Check;
  readonly path: string;
  readonly colors: boolean;
  /** Rows of `channel` (`read`) and of `whole` (`alone`) of the mark's table as last read, and what they were read at. */
  read?: Read;
  alone?: Read;
  /** The same of frames' tables between two scenes, which go with their frames. */
  readonly frames: WeakMap<ReadonlyTable, Reads>;
}

/** Rows a channel read, as `Compiled` keeps them. */
type Reads = Pick<Compiled, "read" | "alone">;

interface Read {
  readonly version: number;
  readonly scaled: number;
  readonly theme: Theme | undefined;
  readonly rows: RowReader<unknown>;
}

/**
 * A mark's draw channels, compiled against its table (`path` names the
 * mark in messages; `reader`, what reads widths and opacities by row).
 */
export function encodedChannels(
  kit: FeatureKit,
  given: readonly DrawChannel[],
  table: Table,
  series: string | undefined,
  scales: ScaleOf,
  path: string,
  reader: string,
): {
  use(theme: Theme, paint: PaintReader): void;
  encoded(
    channel: string,
    row: number,
    series?: CustomSeries,
    frame?: ReadonlyTable,
  ): string | number | undefined;
  seriesColor(name: string, label: string | undefined): string | undefined;
  keys(rows: MarkRows): GlyphKey[];
  /** Whether `keys` gives keys where rows are drawn: a color list reads a scale of categories. */
  hasKeys: boolean;
  /** The number fields whose display colors a color list reads, which the chart's legends key. */
  displayColors: string[] | undefined;
} {
  const compiled = new Map<string, Compiled>();
  for (const { name, output, given: channels, path: option } of given) {
    const at = `${path} ${option}`;
    // Series' outputs are read as the series' colors; widths and opacities are read by row.
    if (output !== "color")
      for (const [i, c] of (Array.isArray(channels) ? channels : [channels]).entries())
        if ("series" in c)
          throw new TypeError(
            `${at}${Array.isArray(channels) ? `[${i}]` : ""}: the series' names give each series one ${name}, and ${reader} reads it by row; give a field, a value, or a condition`,
          );
    const check = outputCheck(output, kit.isColor);
    const read = compileChannel(channels as never, table, scales, output, check, at, output);
    // Only colors end in the series' (widths and opacities refuse its names; a field of the series' is read by row).
    const [channel, tail] = output === "color" ? seriesTail(read, series) : [read, undefined];
    compiled.set(name, {
      channel,
      tail,
      whole: read,
      check,
      path: at,
      colors: output === "color",
      frames: new WeakMap(),
    });
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
    encoded(name, row, series, frame) {
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
      // In frames between two scenes, numbers through a scale (or as they
      // are) read the frame's values; conditions, lists, categories, and
      // display colors read the new values, and change at once.
      const source =
        frame && (channel.kind === "scaled" || (channel.kind === "identity" && channel.numbers))
          ? frame
          : table;
      const reads =
        source === table ? c : (c.frames.get(source) ?? c.frames.set(source, {}).get(source)!);
      let read = reads[slot];
      if (read?.version !== table.version || read.scaled !== scaled || read.theme !== theme) {
        const { colors } = c;
        read = {
          version: table.version,
          scaled,
          theme,
          rows: rowReader(
            channel,
            source,
            colors ? (theme?.palette ?? []) : [],
            (colors ? (theme?.muted ?? "#999999") : undefined) as unknown,
            c.check,
            c.path,
            false,
          ),
        };
        reads[slot] = read;
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
