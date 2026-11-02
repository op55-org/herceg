// State support, imported as `herceg/state`: state options, conditional
// writes, what a selection stands for in each table (`select` events'
// conditions), and selections of items and series. Given to a chart as
// `state: chartState`; a separate entry point, so charts that never set
// their state from outside carry none of it.

export { type ChartStateSupport, chartState } from "./state/chart-state.ts";
