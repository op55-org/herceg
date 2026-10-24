// Portable export settings: what file a chart is written to, apart from the
// chart itself (see spec/export-plan.ts), and the planner's refusals as
// ChartErrors.

import { ChartError } from "./errors.ts";
import { type ExportPlan, type ExportSettings, planWith, type Refuse } from "./export-plan.ts";

export {
  EXPORT_LIMITS,
  type ExportFormat,
  type ExportPlan,
  type ExportSettings,
  type LengthUnit,
  planWith,
  type Refuse,
} from "./export-plan.ts";

/** Refuses with a ChartError, "path: message". */
const refuseChart: Refuse = (path, message, code = "invalid-option") => {
  throw new ChartError({ code, path, message: `${path}: ${message}` });
};

/**
 * Checks `settings` for a chart of `chart` CSS pixels and says what the
 * export draws, or throws a ChartError naming the setting at fault.
 * Exports draw at `pixels`, the layout size times dpi / 96, rounded half
 * up; colors in `background` are read later, as the chart's other colors are.
 */
export function planExport(
  settings: ExportSettings,
  chart: { readonly width: number; readonly height: number },
): ExportPlan {
  return planWith(settings, chart, refuseChart);
}

/**
 * `planExport` for `where` (such as "renderToImage"), its refusals located
 * there: "renderToImage dpi: expected 1 to 1200; ...".
 */
export function planFor(
  where: string,
  settings: ExportSettings,
  chart: { readonly width: number; readonly height: number },
): ExportPlan {
  try {
    return planExport(settings, chart);
  } catch (error) {
    if (!(error instanceof ChartError)) throw error;
    throw new ChartError({
      code: error.code,
      path: error.path,
      message: `${where} ${error.message}`,
    });
  }
}

/** Refuses the setting at `path` of `where` (such as "renderToImage"). */
export function refuseSetting(
  where: string,
  path: string,
  message: string,
  code: "invalid-option" | "unsupported" = "invalid-option",
): never {
  throw new ChartError({ code, path, message: `${where} ${path}: ${message}` });
}
