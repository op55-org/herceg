// Types for the adapters' compile-time checks (packages/react/test/props.types.tsx,
// packages/vue/test/props.types.ts, packages/svelte/test/props.ts): each component takes
// what the engine's function for it takes, by TypeScript's own identity, which tells
// optionality, `readonly`, `any`, and settings at any depth apart.

/** Whether two types are one. */
export type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A type's properties as one object type, union member by union member: an intersection written out. */
export type Flat<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

/** Whether props are `Expected`, member by member. */
export type Takes<Props, Expected> = Same<Flat<Props>, Flat<Expected>>;

/** Props a framework leaves unset rather than undefined: each without undefined, and optional. */
export type Unset<T> = T extends unknown ? { [K in keyof T]?: Exclude<T[K], undefined> } : never;

/** A mark function's props: its options, and its table as `data`. */
export type MarkProps<F> = F extends (data: infer D, options: infer O) => unknown
  ? O & { data: D }
  : never;

/** A table's schema of each kind of field, for field options to check against. */
export type Mixed = { t: "time"; v: "number"; c: "category"; g: "geometry" };
