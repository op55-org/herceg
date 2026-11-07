// Cells as CSV or TSV fields, for exports (export.ts) and copy
// (dom/grid.ts): RFC 4180 quoting, and formulas escaped so spreadsheets
// opening the text read it as text rather than run it.

/**
 * Text a spreadsheet may run: a tab or a line break first, or `=`, `+`,
 * `-`, `@` (or their full-width forms) after any controls, format
 * characters, and spaces, which importers drop (NUL) or trim (spaces).
 */
const FORMULA = /^(?:[\t\r\n]|[\p{Cc}\p{Cf}\p{Z}]*[=+\-@＝＋－＠])/u;
/** What leads a number an importer trims. */
const LEADING = /^[\p{Cc}\p{Cf}\p{Z}]+/u;

/**
 * What writes one cell's text as a field: after a `'` where `escapeFormulas`
 * is on and it starts as a formula would (`FORMULA`), unless it is wholly a
 * number as `locale` writes one (after what leads it) or `plain` (a raw
 * number or time); then in quotes, quotes doubled, where it holds the
 * separator, a quote, or a line break.
 */
export function fieldWriter(
  separator: "," | "\t",
  escapeFormulas: boolean,
  locale: string | undefined,
): (text: string, plain: boolean) => string {
  const quoted = separator === "," ? /[",\r\n]/ : /["\t\r\n]/;
  const number = escapeFormulas ? wholeNumber(locale) : null;
  return (text, plain) => {
    if (
      number &&
      !plain &&
      mayRun(text.charCodeAt(0)) &&
      FORMULA.test(text) &&
      !number.test(text.replace(LEADING, ""))
    )
      text = `'${text}`;
    return quoted.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
}

/**
 * Whether text starting with `code` may start as a formula (`FORMULA`):
 * `=`, `+`, `-`, `@`, a control or a space, or anything past ASCII (a
 * full-width sign, a format character). Most text starts otherwise, and
 * is written without a pattern's test.
 */
function mayRun(code: number): boolean {
  return code === 61 || code === 43 || code === 45 || code === 64 || code <= 32 || code >= 127;
}

/**
 * A signed number as `locale` writes it, which a spreadsheet reads as a
 * number and runs nothing in: digits (ASCII, or the locale's own) in runs
 * between the locale's group separators, a decimal part, an exponent with
 * the locale's separator and minus, and a percent sign where the locale
 * places it ("-1,204", "+3.5%", "-1,2E-7", "+1,2×10^−7", "-12,5 %",
 * "-%12,5", "-١٬٢٣٤٫٥"). Anything else starting with a sign is escaped.
 */
function wholeNumber(locale: string | undefined): RegExp {
  const parts = (options: Intl.NumberFormatOptions, value: number) =>
    new Intl.NumberFormat(locale, options).formatToParts(value);
  // The parts of these types, as a pattern matches them (outside a class, as the `u` flag takes it).
  const text = (from: Intl.NumberFormatPart[], types: string) =>
    from
      .filter(({ type }) => types.includes(type))
      .map(({ value }) => value)
      .join("")
      .replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  // One group separator, in locales that group only from five digits too.
  const plain = parts({}, -12345.5);
  const percent = parts({ style: "percent" }, -0.5);
  const at = percent.findIndex(({ type }) => type === "integer");
  // An exponent's sign may follow a direction mark ("أس؜-٧").
  const scientific = parts({ notation: "scientific" }, 1.2e-7);
  const d = `[0-9${new Intl.NumberFormat(locale, { useGrouping: false }).format(9876543210)}]`;
  return new RegExp(
    `^[+-](?:${text(percent.slice(0, at), "percentSign literal")})?${d}+(?:${text(plain, "group")}${d}+)*(?:${text(plain, "decimal")}${d}+)?(?:(?:[eE]|${text(scientific, "exponentSeparator")})\\p{Cf}*(?:[+-]|${text(scientific, "exponentMinusSign")})?${d}+)?(?:${text(percent.slice(at + 1), "percentSign literal")})?$`,
    "u",
  );
}
