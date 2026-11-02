// A color's own alpha, apart from the chart's color code: highlighting,
// which loads apart from the chart, reads it (see `HighlightKit`).

/**
 * A CSS color's own alpha: of `transparent`, `#rgba` and `#rrggbbaa`, and
 * functions with one (`rgba(…)`, `rgb(… / a)`, `oklch(… / a)`); 1 for
 * others, named colors, variables, and functions of other colors, which
 * are taken as opaque.
 */
export function alphaOf(color: string): number {
  const c = color.trim().toLowerCase();
  if (c === "transparent") return 0;
  const hex = /^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/.exec(c);
  if (hex)
    return hex[1] ? Number.parseInt(hex[1] + hex[1], 16) / 255 : Number.parseInt(hex[2]!, 16) / 255;
  // Functions of colors (`color-mix`, relative colors) are taken as opaque:
  // only a function's own alpha is read.
  const args = /^[a-z-]+\(([^()]*)\)$/.exec(c)?.[1];
  if (args === undefined) return 1;
  const slash = args.lastIndexOf("/");
  const parts = args.split(",");
  const alpha = slash >= 0 ? args.slice(slash + 1) : parts.length === 4 ? parts[3]! : undefined;
  if (alpha === undefined) return 1;
  const value = Number.parseFloat(alpha) / (alpha.trim().endsWith("%") ? 100 : 1);
  return value >= 0 && value <= 1 ? value : 1;
}
