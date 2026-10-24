// The script of Python's web pages (herceg.web.assets()): mounts every
// chart fragment the page has and gets later, and offers herceg/web to the
// page's own modules, which import it from the same URL.

import { observe } from "herceg/web";

export * from "herceg/web";

// The page's other deferred and module scripts run before DOMContentLoaded:
// mounting then, their listeners hear of every chart, `herceg:ready` too.
const timing = performance.getEntriesByType("navigation")[0] as
  | PerformanceNavigationTiming
  | undefined;
if (document.readyState === "complete" || (timing?.domContentLoadedEventStart ?? 0) > 0) observe();
else {
  let started = false;
  const start = () => {
    if (!started) observe();
    started = true;
  };
  document.addEventListener("DOMContentLoaded", start, { once: true });
  // Without navigation timing, the load event if DOMContentLoaded has passed.
  addEventListener("load", start, { once: true });
}
