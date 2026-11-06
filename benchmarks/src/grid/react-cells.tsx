// The cells scenarios' cells (cells.ts) as React elements: `CellView` draws
// what `fillDomCell` draws. `ReactCell`, the React cells scenarios' cell,
// wraps it with state of its own (whether it was pressed), as a cell holding
// a control does, so grids pay for mounting, recycling, and tearing down
// stateful components.

import { type CSSProperties, useState } from "react";
import {
  barEnds,
  CHIP_FILLS,
  inkOver,
  LINK_URL,
  N0_DOMAIN,
  SHAPE_PATHS,
  SYMBOL_BOX,
  shapeOf,
} from "./cells.ts";

export interface CellProps {
  field: string;
  /** The raw value: a number, or a category's label; undefined when missing. */
  value: number | string | undefined;
  text: string;
  /** n4's bar's domain. */
  extent: readonly [number, number];
}

export function CellView({ field, value, text, extent }: CellProps) {
  if (value === undefined) return <div className="bc-cell">{text}</div>;
  if (field === "c0") {
    const fill = CHIP_FILLS[value as string];
    return (
      <div className="bc-cell">
        <span className="bc-chip" style={fill ? { background: fill, color: inkOver(fill) } : {}}>
          {text}
        </span>
      </div>
    );
  }
  if (field === "n1")
    return (
      <div className="bc-cell">
        <a
          className="bc-link"
          href={`${LINK_URL}${encodeURIComponent(String(value))}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text}
        </a>
      </div>
    );
  if (field === "n3")
    return (
      <div className="bc-cell">
        <svg
          className="bc-symbol"
          width={SYMBOL_BOX}
          height={SYMBOL_BOX}
          viewBox={`${-SYMBOL_BOX / 2} ${-SYMBOL_BOX / 2} ${SYMBOL_BOX} ${SYMBOL_BOX}`}
          aria-hidden="true"
        >
          <path d={SHAPE_PATHS[shapeOf(value as number)!]} />
        </svg>
        <span className="bc-text">{text}</span>
      </div>
    );
  const [start, end] = barEnds(value as number, field === "n0" ? N0_DOMAIN : extent)!;
  return (
    <div className="bc-cell">
      <span className="bc-bar" style={{ "--bc-start": start, "--bc-end": end } as CSSProperties} />
      <span className="bc-text">{text}</span>
    </div>
  );
}

/** A cell of the React cells scenarios: `CellView`, under state of its own. */
export function ReactCell(props: CellProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      className="bc-react"
      data-pressed={pressed || undefined}
      onPointerDown={() => setPressed(true)}
    >
      <CellView {...props} />
    </div>
  );
}
