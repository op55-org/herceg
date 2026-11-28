// Networks: graphs of nodes and links, laid out by force or in layers.

import { GraphMark } from "../../marks/graph.ts";
import type { AllMarks } from "../load-with.ts";

export const NETWORKS: Pick<AllMarks, "graph"> = {
  graph: (spec, table, _view, named) =>
    new GraphMark(spec, table(), spec.nodes === undefined ? undefined : named(spec.nodes)),
};
