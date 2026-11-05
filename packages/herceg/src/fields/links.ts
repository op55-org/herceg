// Links of field displays (`link`): a row's URL, made of literal text and
// the row's raw values, URL-encoded, and its text, made of values as their
// displays write them. Only http, https, mailto, and relative URLs are
// links; a URL of another scheme is written as text, never drawn as a link
// (docs/guide/fields.md#links).

import type { FieldKind } from "../data/column.ts";
import type { FieldLink } from "../spec/fields.ts";
import { linkable } from "./check.ts";
import { missingValue } from "./display.ts";

/** Surrogate pairs, and surrogates alone, which `encodeURIComponent` refuses. */
const LONE = /[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g;

/** A row's link, as its field's display makes it: its URL and its text. */
export interface RowLink {
  readonly url: string;
  readonly text: string;
}

/** What links read rows from: a table, or what reads a row's fields as a table does. */
export interface LinkRows {
  has(field: string): boolean;
  kind(field: string): FieldKind;
  value(field: string, row: number): number | string | null;
  fields(): readonly string[];
}

/** A writer of a field's values as text. */
export type LinkWrite = (value: number | string | null) => string;

/**
 * Row `row`'s link of `table`, writing the field's own values with `write`
 * (the surface's writer); undefined for a row missing a value its URL
 * reads, and for a URL whose scheme links do not take.
 */
export type LinkOf = (table: LinkRows, row: number, write: LinkWrite) => RowLink | undefined;

/**
 * The links `link` makes for field `field`'s values, its text parts
 * written with `textOf(table, name)` (field `name`'s display's writer);
 * `at` names it in messages ("chart fields.trace.link"). A part naming a
 * field the table lacks is refused as a table is first read.
 */
export function linker(
  link: FieldLink,
  field: string,
  at: string,
  textOf: (table: LinkRows, name: string) => LinkWrite,
): LinkOf {
  const checked = new WeakSet<LinkRows>();
  return (table, row, write) => {
    if (!checked.has(table)) {
      // The field itself, then each field a part names, at its path.
      const read = (name: string, where: string) => {
        if (table.has(name) && table.kind(name) !== "geometry") return;
        throw new Error(
          `${where}: ${
            table.has(name)
              ? `${JSON.stringify(name)} holds shapes; give a number, time, or category field`
              : `no field ${JSON.stringify(name)} in the table${name === field ? "" : ` of ${JSON.stringify(field)}`}; the table has ${table
                  .fields()
                  .map((one) => JSON.stringify(one))
                  .join(", ")}`
          }`,
        );
      };
      read(field, at);
      for (const key of ["url", "text"] as const) {
        const parts = link[key];
        if (typeof parts === "object")
          parts.forEach((part, i) => {
            if (typeof part === "object" && part.field !== undefined)
              read(part.field, `${at}.${key}[${i}].field`);
          });
      }
      checked.add(table);
    }
    let url = "";
    if (typeof link.url === "string") url = link.url;
    else
      for (const part of link.url) {
        if (typeof part === "string") {
          url += part;
          continue;
        }
        const name = part.field ?? field;
        const value = table.value(name, row);
        // A URL without one of its values would be another address.
        if (missingValue(table.kind(name) as "number", value)) return undefined;
        // Text with a lone surrogate, which no URL encodes, as browsers encode it: U+FFFD.
        url += encodeURIComponent(
          String(value).replace(LONE, (pair) => (pair.length > 1 ? pair : "\ufffd")),
        );
      }
    if (!linkable(url)) return undefined;
    const own = table.value(field, row);
    const text = link.text
      ? link.text
          .map((part) =>
            typeof part === "string"
              ? part
              : part.field === undefined
                ? write(own)
                : textOf(table, part.field)(table.value(part.field, row)),
          )
          .join("")
      : write(own);
    return { url, text };
  };
}
