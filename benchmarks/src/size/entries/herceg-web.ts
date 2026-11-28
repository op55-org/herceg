import { observe } from "herceg/web";

// Pages' chart fragments (Python's herceg.web), mounted as its script does:
// the portable loader with series and annotations. The marks of other
// families, and the spec features a page may not use, load when a spec
// names them (herceg-web-heatmap, herceg-web-dashboard, herceg-web-segment).
export function render() {
  return observe();
}
