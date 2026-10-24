import { line, table } from "herceg";
import { renderToImage } from "herceg/image";

export function render(x: Float64Array, y: Float64Array) {
  return renderToImage(
    { width: 640, height: 320, marks: [line(table({ x, y }), { x: "x", y: "y" })] },
    { format: "jpeg", dpi: 150 },
  );
}
