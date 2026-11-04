// JSON written for people to read and diff: the generated capability
// records and spec schema.

/**
 * `value` as JSON as Biome writes it: each value on one line where that
 * line, with its key and comma, fits in 100 columns.
 */
export function formatJson(value) {
  const inline = (value) => {
    if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return "{}";
      return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }`;
    }
    return JSON.stringify(value);
  };
  // `taken`: the columns the line's indent, key, and comma take beside the value.
  const format = (value, indent, taken) => {
    const line = inline(value);
    if (value === null || typeof value !== "object" || taken + line.length <= 100) return line;
    const inner = `${indent}  `;
    if (Array.isArray(value))
      return `[\n${value
        .map((v, i) => inner + format(v, inner, inner.length + (i < value.length - 1 ? 1 : 0)))
        .join(",\n")}\n${indent}]`;
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return `{\n${entries
      .map(([k, v], i) => {
        const key = `${JSON.stringify(k)}: `;
        const comma = i < entries.length - 1 ? 1 : 0;
        return `${inner}${key}${format(v, inner, inner.length + key.length + comma)}`;
      })
      .join(",\n")}\n${indent}}`;
  };
  return `${format(value, "", 0)}\n`;
}
