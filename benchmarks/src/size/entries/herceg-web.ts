import { observe } from "herceg/web";

// Pages' chart fragments (Python's herceg.web), mounted as its script does:
// the portable loader and every mark a spec can name.
export function render() {
  return observe();
}
