# Financial charts

Candlesticks and OHLC bars, time axes that leave out nights, weekends, and
holidays, crosshair labels, and a range navigator, combined into one chart.

- [Candlesticks and OHLC bars](#candlesticks-and-ohlc-bars)
- [A price chart with volume](#a-price-chart-with-volume)
- [Related](#related)

## Candlesticks and OHLC bars

```ts
candlestick(prices, { x: "day", open: "open", high: "high", low: "low", close: "close" });
candlestick(prices, { x: "day", open: "open", high: "high", low: "low", close: "close", variant: "ohlc" });
```

```python
hg.candlestick(prices, x="day", open="open", high="high", low="low", close="close")
hg.candlestick(prices, "day", "open", "high", "low", "close", variant="ohlc")
```

- Candles that close at or above their open are hollow, in the theme's
  `rise` color (or the mark's `rise`); others are filled in `fall`, so
  direction does not rest on color alone.
- `variant: "ohlc"` draws a line from low to high with the open ticked left
  and the close right, in `rise` or `fall`.
- Rows missing a price are left out; high and low widen to cover open and
  close.
- Tooltips report all four prices; the nearest-point search measures from
  the close. A click anywhere from low to high, as wide as the body,
  selects the row.
- With more candles in view than pixel columns, each column's candles merge
  into one (first open, last close, highest high, lowest low), so no
  extreme is lost. Merged candles are too thin for hollow bodies, so there
  direction is shown by color only.
- Candles take `rise` and `fall` colors, not `color` or series colors.

## A price chart with volume

```ts
import { bar, candlestick, createChart, panels, rangeNavigator, timeBreaks } from "herceg";
import { panel, rows } from "herceg/layout";

createChart(element, {
  marks: [
    candlestick(prices, { x: "time", open: "o", high: "h", low: "l", close: "c", id: "price", panel: "price" }),
    bar(prices, { x: "time", y: "volume", panel: "volume" }),
  ],
  panels: panels([{ id: "price" }, { id: "volume" }], rows([3, 1], [panel("price"), panel("volume")])),
  timeZone: "America/New_York",
  x: {
    seams: true,
    breaks: timeBreaks([
      { weekdays: ["sat", "sun"] },
      { hours: ["16:00", "09:30"] },
      { dates: ["2025-12-25", "2026-01-01"] },
    ]),
  },
  navigator: rangeNavigator({ marks: ["price"] }),
  tooltip: { axisLabels: true },
  interaction: { zoom: true },
});
```

| Piece | Does | Guide |
| --- | --- | --- |
| `x.breaks` | Leaves out nights, weekends, and holidays, so sessions sit side by side; `seams: true` marks the boundaries. | [Time axis breaks](axes-and-legends.md#time-axis-breaks) |
| `panels` with `rows` | A price panel over a volume panel, sharing x. | [Layout](layout.md#subplots) |
| `rangeNavigator` | A strip under the panels over the whole x axis, with a window over the range in view. | [Range navigator](interaction.md#range-navigator) |
| `tooltip.axisLabels` | Labels the crosshair on the axes. | [Tooltips](interaction.md#tooltips) |

## Related

- Moving averages and other rolling statistics:
  [derived tables](data.md#derived-tables) (`rolling`).
- Streaming prices into a rolling window:
  [Changing data](data.md#changing-data-and-streaming).
- Drawing tools (trend lines and the like) are not available; see the
  [roadmap](../roadmap.md).
