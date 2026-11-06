// How a grid looks: one stylesheet for its elements, which every grid
// carries in its own root (so grids inside shadow roots are styled too), and
// the theme as custom properties on that root.
//
// Cells' looks (grid/looks.ts) are custom properties of their own:
// `--hg-look-fill` paints the cell's background over the surface (opaque,
// `--hg-under`: a translucent one taken over the page), and `--hg-look-color`
// its text. Without a color, text over a fill is black or
// white, whichever has the higher WCAG contrast with what it lands on: the
// fill composited over the surface, and in selected rows the selection's
// tint over that, against WCAG's crossover of 0.1791 relative luminance.
// The grid works it out for fills it reads (`contrastOf`) and gives both
// inks as `--hg-look-ink` and `--hg-look-ink-selected`; for fills only the
// page reads exactly (its CSS variables, color names, see `colorChannels`),
// they are relative colors the page works out the same way (`PAGE_INKS`),
// slower to style.

import { colorChannels, isLightColor } from "../scale/color.ts";
import type { ResolvedTokens } from "../theme.ts";

const G = ".herceg-grid";

/** A fill over the surface, opaque; `--hg-sr` and the rest are the surface's channels, from 0 to 1. */
const UNDER =
  "color(from var(--hg-look-fill) srgb calc(r*alpha + var(--hg-sr)*(1 - alpha)) calc(g*alpha + var(--hg-sg)*(1 - alpha)) calc(b*alpha + var(--hg-sb)*(1 - alpha)) / 1)";
/** That under the selection's tint: the accent's channels at `--hg-tint`, its opacity (see `--hg-selected`). */
const TINTED = `color(from ${UNDER} srgb calc(r*(1 - var(--hg-tint)) + var(--hg-ar)*var(--hg-tint)) calc(g*(1 - var(--hg-tint)) + var(--hg-ag)*var(--hg-tint)) calc(b*(1 - var(--hg-tint)) + var(--hg-ab)*var(--hg-tint)) / 1)`;
/** Black or white text on `under`, by its relative luminance (`--hg-ink`, one channel). */
const ink = (under: string) =>
  `color(from ${under} srgb-linear var(--hg-ink) var(--hg-ink) var(--hg-ink))`;

/** The inks of a fill only the page reads exactly: in plain rows and in selected rows. */
export const PAGE_INKS: readonly [string, string] = [ink(UNDER), ink(TINTED)];

/** The relative luminance at which black and white text have the same WCAG contrast. */
const CROSSOVER = 0.1791;
/** How much of the accent selected rows' tint takes. */
const SELECTED = 0.16;

export const GRID_CSS = `
${G}{position:relative;font-family:var(--hg-font);font-size:var(--hg-size);color:var(--hg-text);background:var(--hg-background)}
${G} .hg-scroller{position:absolute;inset:0;overflow:auto;overflow-anchor:none;scroll-behavior:auto;outline-offset:-2px}
${G} .hg-scroller:focus-visible{outline:2px solid var(--hg-accent)}
${G} .hg-header{position:sticky;top:0;z-index:2;width:max-content;min-width:100%;background:var(--hg-surface)}
${G} .hg-header [role=row]{position:relative;display:flex;height:var(--hg-header-height);box-sizing:border-box;border-bottom:1px solid var(--hg-rule)}
${G} .hg-body{position:relative;overflow:clip}
${G} .hg-body [role=row]{position:absolute;display:flex;left:0;top:0;height:var(--hg-row-height);box-sizing:border-box;border-bottom:1px solid var(--hg-line)}
${G} [role=gridcell],${G} [role=columnheader]{position:absolute;top:0;height:100%;box-sizing:border-box;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
${G} [role=gridcell]{line-height:calc(var(--hg-row-height) - 1px)}
${G} [role=columnheader]{line-height:calc(var(--hg-header-height) - 1px);color:var(--hg-muted);font-weight:600;user-select:none;cursor:default}
${G} [data-align=end]{text-align:end;font-variant-numeric:tabular-nums}
${G} [data-align=center]{text-align:center}
${G} .hg-sort{margin-inline-start:4px;font-size:0.85em}
${G} [data-selection=all]{background:var(--hg-selected);box-shadow:inset 3px 0 var(--hg-accent)}
${G} [role=gridcell]:focus,${G} [role=columnheader]:focus{outline:2px solid var(--hg-accent);outline-offset:-2px}
${G} [data-pin]{position:sticky;top:auto;flex:none;z-index:1;background:var(--hg-surface)}
${G} [data-edge=left]{border-right:1px solid var(--hg-rule)}
${G} [data-edge=right]{border-left:1px solid var(--hg-rule)}
${G} [data-selection=all]>[data-pin]{background:linear-gradient(var(--hg-selected),var(--hg-selected)) var(--hg-surface)}
${G} [data-selection=all]>[data-pin][aria-colindex="1"]{box-shadow:inset 3px 0 var(--hg-accent)}
${G}{--hg-ink:clamp(0,(${CROSSOVER} - 0.2126*r - 0.7152*g - 0.0722*b)*1e6,1)}
${G} [data-look~=color]{color:var(--hg-look-color)}
${G} [data-look~=fill]{background:linear-gradient(var(--hg-look-fill),var(--hg-look-fill)) var(--hg-under);color:var(--hg-look-color,var(--hg-look-ink))}
${G} [data-selection=all]>[data-look~=fill]{background:linear-gradient(var(--hg-selected),var(--hg-selected)),linear-gradient(var(--hg-look-fill),var(--hg-look-fill)) var(--hg-under);color:var(--hg-look-color,var(--hg-look-ink-selected))}
${G} [data-selection=all]>[data-look~=fill][aria-colindex="1"]{box-shadow:inset 3px 0 var(--hg-accent)}
${G} .hg-menu-button{position:absolute;top:0;right:6px;display:none;width:18px;height:100%;text-align:center;cursor:pointer;color:var(--hg-muted);background:var(--hg-surface)}
${G} .hg-menu-button::before{content:"\\22EE"}
${G} [role=columnheader]:hover>.hg-menu-button,${G} [role=columnheader]:focus>.hg-menu-button{display:block}
${G} .hg-resize{position:absolute;top:0;right:0;width:6px;height:100%;cursor:col-resize;touch-action:none}
${G} [role=columnheader]:hover>.hg-resize{background:linear-gradient(var(--hg-rule),var(--hg-rule)) right/2px 50% no-repeat}
${G} [data-pin=right]>.hg-resize{right:auto;left:0}
${G} [role=columnheader][data-pin=right]:hover>.hg-resize{background-position:left}
${G} [data-pin=right]>.hg-menu-button{right:2px}
${G}[data-dragging=resize] .hg-scroller{cursor:col-resize}
${G}[data-dragging=move] .hg-scroller{cursor:grabbing}
${G} [data-moving]{opacity:0.5}
${G} .hg-drop{position:absolute;top:0;z-index:3;width:2px;height:calc(var(--hg-header-height)*var(--hg-header-rows,1));background:var(--hg-accent);pointer-events:none}
${G} .hg-menu{position:absolute;z-index:3;box-sizing:border-box;min-width:200px;overflow:auto;padding:4px 0;font-weight:400;color:var(--hg-text);background:var(--hg-surface);border:1px solid var(--hg-rule);border-radius:4px;box-shadow:0 4px 16px rgb(0 0 0 / 0.2)}
${G} .hg-menu [role^=menuitem]{position:relative;display:flex;gap:24px;padding:4px 12px 4px 28px;line-height:20px;white-space:nowrap;cursor:pointer}
${G} .hg-menu [role^=menuitem]:focus{outline:2px solid var(--hg-accent);outline-offset:-2px;background:var(--hg-selected)}
${G} .hg-menu [aria-checked=true]::before{content:"\\2713" / "";position:absolute;left:10px}
${G} .hg-menu [aria-disabled=true]{color:var(--hg-muted);cursor:default}
${G} .hg-keys{margin-left:auto;color:var(--hg-muted)}
${G} .hg-menu [role=separator]{height:1px;margin:4px 0;background:var(--hg-rule)}
${G} .hg-menu-title{padding:4px 12px;color:var(--hg-muted);font-size:0.85em}
${G} .hg-body [aria-expanded]{font-weight:600}
${G} .hg-body [aria-expanded]>[aria-colindex="1"]{text-align:start;padding-inline-start:calc(8px + var(--hg-indent) * (1em + 6px))}
${G} .hg-body [aria-level]:not([aria-expanded])>[aria-colindex="1"]{padding-inline-start:calc(34px + 1em + var(--hg-indent) * (1em + 6px))}
${G} .hg-controls{display:inline-flex;align-items:center;gap:6px;height:100%;margin-inline-end:6px;vertical-align:top}
${G} .hg-toggle{width:1em;text-align:center;cursor:pointer;color:var(--hg-muted)}
${G} .hg-toggle::before{content:"\\25B8"}
${G} [aria-expanded=true] .hg-toggle::before{content:"\\25BE"}
${G} .hg-check{width:12px;height:12px;box-sizing:border-box;border:1px solid var(--hg-muted);border-radius:2px;cursor:pointer}
${G} .hg-check[aria-checked=true]{background:var(--hg-accent);border-color:var(--hg-accent)}
${G} .hg-check[aria-checked=mixed]{background:linear-gradient(var(--hg-accent),var(--hg-accent)) center/6px 2px no-repeat}
@media (forced-colors:active){
${G} [data-selection=all]{forced-color-adjust:none;background:Highlight;color:HighlightText;box-shadow:none}
${G} [role=gridcell]:focus,${G} [role=columnheader]:focus,${G} .hg-scroller:focus-visible,${G} .hg-menu [role^=menuitem]:focus{outline-color:CanvasText}
${G} [data-selection=all]>[data-pin]{background:Highlight}
${G} .hg-drop{forced-color-adjust:none;background:Highlight}
${G} .hg-check{forced-color-adjust:none;border-color:currentColor}
${G} .hg-check[aria-checked=true]{background:currentColor}
${G} .hg-check[aria-checked=mixed]{background:linear-gradient(currentColor,currentColor) center/6px 2px no-repeat}
${G} [role=row]>[data-look]{background:none;color:inherit}
${G} [role=row]>[data-pin][data-look]{background:Canvas}
${G} [data-selection=all]>[data-pin][data-look]{background:Highlight}
}`;

/** What cells are drawn over: the theme's background, or where it is transparent its tooltips' fill. */
function surfaceOf({ tokens, roles }: ResolvedTokens): string {
  return tokens.background === "transparent" ? roles.tooltip.fill : tokens.background;
}

/**
 * The surface's channels (opaque, over the page) and the accent's from 0 to
 * 255, and the opacity of the selection's tint (16% of the accent's), which
 * cells' contrast reads.
 */
function contrastChannels(theme: ResolvedTokens): {
  surface: readonly [number, number, number];
  accent: readonly [number, number, number];
  tint: number;
} {
  const [r, g, b, alpha] = colorChannels(surfaceOf(theme)) ?? [255, 255, 255, 1];
  // A translucent surface shows the page through, which the grid cannot
  // read: taken as white under dark text, and black under light text.
  const page = isLightColor(theme.tokens.text) ? 0 : 255;
  const over = (channel: number) => channel * alpha + page * (1 - alpha);
  const accent = colorChannels(theme.tokens.palette[0]!) ?? [0, 0, 0, 1];
  return {
    surface: [over(r), over(g), over(b)],
    accent: [accent[0], accent[1], accent[2]],
    tint: SELECTED * accent[3],
  };
}

/**
 * The inks of text over a fill in `theme`, in plain rows and in selected
 * rows (see above); undefined for a fill the grid does not read exactly (a
 * CSS variable, a name), whose inks are `PAGE_INKS`.
 */
export function contrastOf(theme: ResolvedTokens): (fill: string) => [string, string] | undefined {
  const { surface, accent, tint } = contrastChannels(theme);
  const ink = (rgb: readonly number[]) => {
    const linear = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * linear(rgb[0]!) + 0.7152 * linear(rgb[1]!) + 0.0722 * linear(rgb[2]!);
    return l < CROSSOVER ? "#ffffff" : "#000000";
  };
  return (fill) => {
    const channels = colorChannels(fill);
    if (!channels) return undefined;
    const alpha = channels[3];
    const under = [0, 1, 2].map((i) => channels[i]! * alpha + surface[i]! * (1 - alpha));
    return [ink(under), ink(under.map((c, i) => c * (1 - tint) + accent[i]! * tint))];
  };
}

/** The theme as the custom properties the stylesheet reads. */
export function themeProperties(
  theme: ResolvedTokens,
  rowHeight: number,
  headerHeight: number,
): Record<string, string> {
  const { tokens, roles } = theme;
  const accent = tokens.palette[0]!;
  const surface = surfaceOf(theme);
  // Channels from 0 to 1, which the page's contrast with fills it reads takes (see above).
  const channels = contrastChannels(theme);
  const [sr, sg, sb] = channels.surface;
  const [ar, ag, ab] = channels.accent;
  const unit = (channel: number) => String(channel / 255);
  return {
    "--hg-font": roles.text.font!,
    "--hg-size": `${roles.text.fontSize}px`,
    "--hg-text": tokens.text,
    "--hg-muted": tokens.muted,
    "--hg-line": tokens.grid,
    "--hg-rule": tokens.axis,
    "--hg-accent": accent,
    "--hg-selected": `color-mix(in srgb, ${accent} ${SELECTED * 100}%, transparent)`,
    // The sticky header covers rows scrolling under it, so it needs a color of its own.
    "--hg-surface": surface,
    // What fills are painted over: the surface the inks are worked out against, opaque.
    "--hg-under": colorChannels(surface) ? `rgb(${sr} ${sg} ${sb})` : surface,
    "--hg-sr": unit(sr),
    "--hg-sg": unit(sg),
    "--hg-sb": unit(sb),
    "--hg-ar": unit(ar),
    "--hg-ag": unit(ag),
    "--hg-ab": unit(ab),
    "--hg-tint": String(channels.tint),
    "--hg-background": tokens.background,
    "--hg-row-height": `${rowHeight}px`,
    "--hg-header-height": `${headerHeight}px`,
  };
}
