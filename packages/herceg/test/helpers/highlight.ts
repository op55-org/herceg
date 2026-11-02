import type { Table } from "../../src/data/table.ts";
import { Highlighter } from "../../src/model/highlight.ts";
import {
  channelSelection,
  channelsChosen,
  type HighlightedChannel,
  membership,
} from "../../src/model/memberships.ts";
import { HIGHLIGHT_KIT } from "../../src/model/row-selection.ts";

/**
 * A highlighter of stores' channels, as `rowSelection()` makes one, with
 * what each table's channel holds for layout marks (`selected`).
 */
export function channelHighlighter(channels: readonly HighlightedChannel[]) {
  return Object.assign(new Highlighter(HIGHLIGHT_KIT, channelsChosen(channels)), {
    selected(table: Table): Uint8Array | undefined {
      const selection = channelSelection(channels, table);
      return selection && membership(table, selection);
    },
  });
}
