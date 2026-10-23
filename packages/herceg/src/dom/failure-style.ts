// The look of what a mounted chart shows when it cannot draw, loaded with
// its first failure: until then the alert shows its text unstyled (see
// dom/chart.ts, `#fail`). It looks as `showFailure` (dom/errors.ts) draws
// one, whose module a chart's first chunk does not carry.

/** Styles `shown`, an alert saying why a chart could not draw: a box over the chart, or with `kept`, a banner over its last frame. */
export function styleFailure(shown: HTMLElement, kept: boolean): void {
  shown.style.cssText = `visibility:visible;box-sizing:border-box;padding:8px 12px;overflow:auto;white-space:pre-line;font:13px/1.4 system-ui,sans-serif;color:#410e0b;background:#fff8f7;border:1px solid #f2b8b5;position:absolute;inset:0;${kept ? "bottom:auto;max-height:50%" : ""}`;
}
