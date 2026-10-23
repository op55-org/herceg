// Where text attached to another mark's series goes: direct labels
// (`labels` on lines and areas) and text `from` a mark. The marks whose
// series are labeled say where each label's anchor is (an `Attachment`);
// layout places the labels' blocks there (`anchorBlock`). Rules every
// producer and reader keeps:
// - `first` and `last` are the first and last drawable observations of the
//   series in its traversal order, before level of detail reduces it.
// - `visible-start` and `visible-end` are the ends of the series' visible
//   connected path, where it crosses the view's edge too, as the path is
//   drawn (steps held, monotone curves as curved), in traversal order,
//   which reversed axes do not change. A series with nothing visible has no
//   visible-edge label.
// - A point on a segment is owned by the observation the segment arrives
//   at, a point on a step's flat run by the observation whose value it
//   holds, as a segment's style is. Field parts of a label read the owning
//   observation; `{ value: true }` reads the value drawn at the point.
// - A band's labels follow its `edge` (y1 or y2, x1 or x2, as declared);
//   other areas follow their value edge.
// - Attachments resolve within the source mark's panel; a reference that
//   panels make ambiguous is refused. Hidden series hide their labels.
// - Labels make no rows: they are not selected, inspected, or stops of the
//   keyboard, and dependent text takes no table of its own.

/** A label's anchor on a series of another mark, as the series is drawn. */
export interface Attachment {
  /** The panel it is drawn in, which its source mark's series is in. */
  readonly panel: string;
  /** The source mark's index among the chart's marks, and the series' key. */
  readonly mark: number;
  readonly series: string;
  /** The observation owning the point: its row in the source mark's table. */
  readonly row: number;
  /** The value drawn at the point, along the series' value axis. */
  readonly value: number;
  /** The point, in CSS pixels of the chart. */
  readonly x: number;
  readonly y: number;
  /** Whether the series is shown: hidden series' labels are not drawn. */
  readonly visible: boolean;
}
