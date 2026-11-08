import { describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";

describe("selection stores", () => {
  it("keep each channel's selection, and filter views by their conditions", () => {
    const t = table({ t: [0, 1, 2, 3, 4], host: ["a", "b", "a", "b", "a"] });
    const store = selectionStore(t);
    let changes = 0;
    store.subscribe(() => changes++);
    store.set("brush", selectWhere(col("t").ge(1).and(col("t").le(3))));
    store.set("legend", selectWhere(col("host").eq("a")));
    store.set("grid", selectRows(new RowSet(t).add(0)));
    expect(store.channels).toEqual(["brush", "legend", "grid"]);
    const view = rowView(t, { filter: store.condition(["brush", "legend"]) });
    expect(Array.from(view.read().indices!)).toEqual([2]);
    store.set("brush", null);
    store.set("brush", null);
    expect(changes).toBe(4);
    expect(store.condition(["brush", "grid"])).toBeUndefined();
  });

  it("freeze what they hold in place, keeping its identity", () => {
    const t = table({ x: [1, 2, 3] });
    const store = selectionStore(t);
    const rows = new RowSet(t).add(0);
    const given = { kind: "rows" as const, rows };
    store.set("grid", given);
    expect(store.get("grid")).toBe(given);
    expect(Object.isFrozen(given)).toBe(true);
    expect(() => rows.add(1)).toThrow(/frozen/);
    expect(() => {
      (given as { kind: string }).kind = "predicate";
    }).toThrow(TypeError);
    // A condition's expression is frozen through, as given.
    const expression = ["and", [">=", ["field", "x"], 1], ["<=", ["field", "x"], 2]] as const;
    const condition = { kind: "predicate" as const, expression };
    store.set("brush", condition);
    expect(store.get("brush")).toBe(condition);
    expect(() => {
      (expression[1] as unknown as unknown[])[2] = 3;
    }).toThrow(TypeError);
    // selectRows and selectWhere give frozen selections.
    const made = selectWhere(col("x").ge(2));
    expect(Object.isFrozen(made) && Object.isFrozen(made.expression)).toBe(true);
    const copy = rows.copy().add(2);
    selectRows(copy);
    expect(() => copy.add(1)).toThrow(/frozen/);
  });

  it("refuse selections of another table, and conditions that are not true or false", () => {
    const store = selectionStore(table({ x: [1] }));
    expect(() => store.set("grid", selectRows(new RowSet(table({ x: [1] }))))).toThrow(
      /store's table/,
    );
    expect(() => store.set("brush", selectWhere(col("x")))).toThrow(/true or false/);
  });
});
