// How a tree's fields go together (treemaps and sunbursts), checked by the
// tree's data and by spec validation (spec/validate.ts) without loading it.

/** Why a tree's fields name it neither or both ways (a path, or node and parent), if they do. */
export function treeFormError(
  fields: { path?: unknown; node?: unknown; parent?: unknown },
  role: string,
): string | undefined {
  if (fields.path !== undefined && (fields.node !== undefined || fields.parent !== undefined))
    return `${role}: a path, or node and parent fields, not both; drop one`;
  if (fields.path === undefined && (fields.node === undefined || fields.parent === undefined))
    return `${role}: needs a path of category fields, or node and parent fields`;
  return undefined;
}
