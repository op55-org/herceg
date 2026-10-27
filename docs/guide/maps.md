# Maps

Maps draw `geoshape` regions (choropleths) and `geopoint` points or bubbles
on one projection. The two share a chart with each other, not with other
marks.

- [A first map](#a-first-map)
- [Shapes and data](#shapes-and-data)
- [Regions and points](#regions-and-points)
- [Projections](#projections)
- [Zooming, panning, and lassos](#zooming-panning-and-lassos)
- [Readings and performance](#readings-and-performance)

## A first map

```ts
import { createChart, fromGeoJSON, geopoint, geoshape, table } from "herceg";

const countries = fromGeoJSON(await (await fetch("countries.geojson")).json());
const cities = table({ city: names, lon: longitudes, lat: latitudes, population });

createChart(element, {
  projection: "equal-earth",
  marks: [
    geoshape(countries, { labelField: "name", color: "gdp" }), // a choropleth
    geopoint(cities, { longitude: "lon", latitude: "lat", size: "population", labelField: "city" }),
  ],
});
```

```python
hg.choropleth(countries_gdf, "gdp", label_field="name", projection="equal-earth")
hg.choropleth(rates, "rate", geojson=counties, locations="fips")  # values joined to shapes
hg.scatter_geo(cities, "lon", "lat", size="population", label_field="city")
hg.Chart(countries, projection="natural-earth").geoshape(color="gdp").geopoint(
    "lon", "lat", data=cities, size="population")
```

## Shapes and data

Regions come from a geometry field: polygons and multipolygons in
longitude and latitude (degrees, WGS 84).

| Source | Reads |
| --- | --- |
| `fromGeoJSON(collection)` | A FeatureCollection: shapes in a `geometry` field (points in `longitude` and `latitude`), feature ids in `id`, each property in a field of its own. |
| `geometry(set, codes?)` | Packed arrays, as GeoArrow nests multipolygons (see [Specs](export.md#charts-from-specs)). |
| Python | GeoPandas GeoDataFrames, GeoJSON dicts, or columns of GeoJSON geometries or `__geo_interface__` objects (Shapely), without importing GeoPandas or Shapely. Shapes travel as packed binary arrays. |

- Rows hold codes into the shapes, so filtered and sorted derived tables
  share them, and appended rows name existing shapes by code.
- Edges are straight in longitude and latitude, as GeoJSON defines them;
  shapes crossing the antimeridian should be cut there (RFC 7946).
- Coordinates out of range are refused (projected data, for instance). In
  Python, a GeoDataFrame in a projected reference system is refused with a
  hint to `to_crs(4326)`.
- **Joining values (Python).** As in Plotly, `geojson=` with `locations=`
  and `feature_id_key=` (`"id"` or `"properties.<name>"`, compared as text,
  so leading zeros count) joins a dataframe's values to the features. Every
  feature is drawn; those no row names have no value.
- A live chart replaces a table of shapes whole rather than appending to
  it.

## Regions and points

| `geoshape` option | Means |
| --- | --- |
| `color` | A number field on a continuous scale (`colors`, `colorDomain`, `colorMidpoint`), or a category field, a palette color per value, whose legend grays regions out without moving the map. |
| `fill` | Regions without a value, or a map without `color` (the theme's grid color by default). |
| `stroke`, `strokeWidth` | Borders, in the background color, 0.75 px by default. |
| `geometry` | The geometry field, when the table has several. |
| `labelField` | A category field naming regions in tooltips and keyboard reading. |

| `geopoint` option | Means |
| --- | --- |
| `longitude`, `latitude` | Number fields. |
| `radius`, `size`, `radiusRange` | One radius (4 px), or area by a field (2 to 16 px by default, with a size key). |
| `series`, `color` | Series colors, or a number field on a continuous scale. Map points refuse colors row by row. |
| `labelField` | Names points in tooltips and keyboard reading. |

Points are drawn at 0.8 opacity, ringed in the background color, largest
first so smaller points stay on top. Points missing an encoded value are
left out.

## Projections

The chart's `projection` is a name or `{ type, centralMeridian?, parallels?,
fit? }` (Python `hg.Projection(type, central_meridian=, parallels=, fit=)`).

| Projection | |
| --- | --- |
| `"equal-earth"` (default) | Equal-area, for world maps. |
| `"natural-earth"` | A compromise for world maps. |
| `"mercator"` | Conformal; cut at 85.05° latitude. |
| `"equirectangular"` | Longitude and latitude as they are. |
| `"conic-equal-area"` | Albers' equal-area conic, for countries and continents. |

| Setting | Means |
| --- | --- |
| `centralMeridian` | The longitude at the center (0; for the conic, the middle of the data across the widest gap). Shapes are cut at the opposite meridian. |
| `parallels` | The conic's standard parallels (a sixth of the data's latitude span in from each end). |
| `fit` | `"data"` (default), `"world"`, or a box `[[west, south], [east, north]]` (west may lie east of east, crossing the antimeridian). Hiding categories does not change the fit. |

Edges are divided until they are drawn within a quarter pixel of their
projected curves, at any zoom.

## Zooming, panning, and lassos

```ts
const chart = createChart(element, {
  marks: [geoshape(countries, { labelField: "name", color: "gdp" })],
  interaction: { zoom: true, brush: "lasso" },
  rowSelection: rowSelection({ store: selectionStore(countries), channel: "picked" }),
});
chart.on("viewport", ({ views }) => console.log(views[0]?.x, views[0]?.y)); // the plane's ranges, null when fitted
chart.setViewport({ x: [0.1, 0.4], y: [0.6, 0.8] });
chart.setViewport(null); // the fitted map
```

```python
hg.Chart(countries, zoom=True, brush="lasso",
         row_selection=hg.SelectionBinding("picked")).geoshape(color="gdp")
```

- **Gestures.** `interaction.zoom` (`true` or `"xy"`): the wheel with Ctrl
  or ⌘ (trackpad pinch) zooms at the pointer, a drag pans, double-click or
  0 shows the whole map, Shift+arrows pan, plus and minus zoom, and a
  toolbar does all of it. `pan: true` pans without zooming. Zoom runs from
  the whole map to 256 times its scale.
- **The view** is the chart's viewport: x and y ranges of the projection's
  plane (Earth radii, x east, y north). A box shows whole, centered; a
  range along one axis keeps the other's middle; null fits the map.
- **Lassos.** With `brush: "lasso"`, a drag draws a lasso (Shift-drag pans);
  with `rowSelection`, it selects regions whose anchor (a fixed point inside
  each) and points whose center lie inside. A click selects the region or
  point under it. Layers of one table share its binding.
- **Panels.** Facet panels share one view; a map in a subplot has its own
  (`setViewport(view, { panel })`).
- **Changing the projection** keeps the view and lasso, which are in the
  old projection's units: reset them (`setViewport(null)`, `select(null)`)
  with it. The Python widget and Streamlit do so themselves.

## Readings and performance

- Tooltips and the arrow keys report a region's name and value (or
  category) and a point's name and size, regions first in row order. The
  pointer finds the last-drawn point within 3 px, else the last-drawn region
  containing it (holes excluded).
- The description summarizes each layer: the regions' value range with the
  highest and lowest, and the points' count and largest.
- Regions are projected once per projection and fit, so changing values,
  colors, the legend, or the theme draws without projecting again. 200
  regions of 1,000 vertices with 10,000 points take about 20–30 ms to draw
  first and 2 ms to redraw (Node).
- A zoomed map reuses projected shapes at four scale levels per doubling,
  so panning projects nothing for a long way and zooming projects again
  only past a level. Those regions pan in about 0.6 ms a frame and zoom a
  level in 5 ms on Canvas, 10 ms in SVG (Chrome, Apple M6).
- Maps refuse value animation.
