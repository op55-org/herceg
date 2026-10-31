// What a custom mark's `encode` gives its `draw`: each channel's output for
// a row (`DataDrawContext.encoded`), compiled as every mark's channels are
// (channels.ts), read per table version, theme, and channel scales'
// domains; and the colors a color channel gives series (a constant, the
// series field's values, or the series' names through a scale).

import type { Table } from "../../data/table.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { ChannelName } from "../../spec/channels.ts";
import type { EncodingsSpec } from "../../spec/encoding.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import {
  type Channel,
  type Check,
  compileChannel,
  outputCheck,
  type RowReader,
  rowReader,
  type ScaleOf,
  scaledRevision,
} from "./channels.ts";

/** The channels a custom mark's `draw` reads. */
const CHANNELS = ["color", "strokeWidth", "opacity"] as const;
type Name = (typeof CHANNELS)[number];

interface Compiled {
  readonly channel: Channel<unknown>;
  readonly check: Check;
  readonly path: string;
  /** Its rows as last read, and what they were read at. */
  read?: { version: number; scaled: number; theme: Theme | undefined; rows: RowReader<unknown> };
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
  encoded(channel: Name, row: number): string | number | undefined;
  seriesColor(name: string, label: string | undefined): string | undefined;
} {
  const compiled = new Map<Name, Compiled>();
  for (const name of CHANNELS) {
    const given = encode?.[name];
    if (!given) continue;
    const at = `${path} encode.${name}`;
    // Series' outputs are read as the series' colors; draw reads widths and opacities by row.
    if (name !== "color" && "series" in given)
      throw new TypeError(
        `${at}: the series' names give each series one ${name}, and draw reads it by row; give a field, a value, or a condition`,
      );
    const check = outputCheck(name as ChannelName, kit.isColor);
    compiled.set(name, {
      channel: compileChannel(given as never, table, scales, name, check, at, name),
      check,
      path: at,
    });
  }
  let theme: Theme | undefined;
  return {
    use(t) {
      theme = t;
    },
    encoded(name, row) {
      const c = compiled.get(name);
      // The series' names color series, which `draw` reads as their color.
      if (!c || c.channel.kind === "series") return undefined;
      const scaled = scaledRevision([c.channel]);
      if (c.read?.version !== table.version || c.read.scaled !== scaled || c.read.theme !== theme) {
        const colors = name === "color";
        c.read = {
          version: table.version,
          scaled,
          theme,
          rows: rowReader(
            c.channel,
            table,
            colors ? (theme?.palette ?? []) : [],
            (colors ? (theme?.muted ?? "#999999") : undefined) as unknown,
            c.check,
            c.path,
            false,
          ),
        };
      }
      return c.read.rows.output(row) as string | number | undefined;
    },
    seriesColor(name, label) {
      const channel = compiled.get("color")?.channel as Channel<string> | undefined;
      if (!channel || !theme) return undefined;
      if (channel.kind === "value") return channel.value;
      if (channel.kind === "series")
        return channel.scale.output(label ?? name, theme.palette, theme.muted);
      if (channel.kind === "field" && channel.field === series)
        return channel.scale.output(name, theme.palette, theme.muted);
      return undefined;
    },
  };
}
