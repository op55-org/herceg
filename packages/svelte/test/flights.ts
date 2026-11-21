// The data of the <Custom> tests: flights, each from its start to its end on
// a lane, and points.
import { type Table, table } from "herceg";

export const flights = () => table({ id: ["a", "b"], start: [0, 10], end: [40, 50], lane: [1, 2] });
export type Flights = ReturnType<typeof flights>;
export type FlightSchema = Flights extends Table<infer S> ? S : never;

export const points = () => table({ t: [0, 1, 2, 3], v: [1, 3, 2, 4] });
export type Points = ReturnType<typeof points>;
