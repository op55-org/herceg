// The API audit: every option, event, and choice of the spec reaches each
// surface under the name that surface's convention makes of it, or
// test/contracts/api.json says why not. Each audit compares a reference
// (the spec, or the surface another derives from) with a surface, both
// found in the code by inventory.mjs. The adapters' components are
// compared with the engine's functions at compile time instead, where
// TypeScript tells their types apart at any depth (props.mjs requires a
// check of every component); the audit names their chart props, events,
// and Vue's bare attributes.
//
//   names <surface>          the spec's mark types and their mark functions' and methods' names,
//                            and Chart's mark methods and Panel's
//   mark <type> typescript   the spec's mark options and its mark function's
//   mark <type> python       ... and its Chart method's keywords, in snake_case
//   mark <type> panel        the Chart method's keywords and the Panel method's
//   mark <type> helper       ... and the one-call helper's own (HelperOptions apart), with
//                            the settings each takes
//   mark <type> helper options   HelperOptions and the chart's options the helper unpacks
//   chart <surface>          ChartSpec and TypeScript's, the adapters', and Python's options
//   chart update             TypeScript's update() and the widget's update()
//   panel <surface>, inset <surface>   PanelSpec and InsetSpec likewise
//   events <surface>         ChartEvents and each surface's listeners
//   handle python            the chart handle's members and the notebook widget's
//   express <function>       the keywords Express functions share, or the core's marks take,
//                            alike in each
//   express <function> options   HelperOptions and the chart's options it unpacks
//   express <function> seaborn   seaborn's function of that name and its keywords
//   express <function> <keyword> the settings a keyword holds: of a keyword dict of seaborn's
//                            (histplot's kde_options, seaborn's kde_kws), what seaborn's class
//                            it holds takes; of a class of the core's other than the one its
//                            marks hold for that keyword, theirs; of Express's own, none
//   vue flags <component>    the options a Vue component's props let be true, and those
//                            it reads as true from bare attributes
//   <audit> <option> ...     the settings of an option both sides type, at any depth, by
//                            where they are (`chart python x style`), or where both sides
//                            name their types, once a pair wherever they are met
//   settings <type> <type>   (`settings TicksSpec hg.Ticks`); a class with no settings of
//                            its own (hg.IdentityScale) counts as typed, and settings held
//                            by name on one side (a dict of them: Python's limits={"x": ...})
//                            are audited as each of the other side's named settings
//
// api.json's `audits` lists each audit's differences, with their reasons:
// `spelled` (a reference option the surface spells otherwise: `{ as,
// reason }`), `spread` (a reference option whose settings are the
// surface's options: `{ prefix?, as?, reason }`), `without` (a reference
// option the surface does not take), `only` (an option of the surface's
// own), `choices` (an option whose string choices differ: `{ takes, reason
// }`, the choices the surface takes), and `untyped`
// (an option, or a spread one's setting as `option.setting`, whose settings
// one side types and the other takes untyped: a dict, Any, an instance). An
// audit named `mark * <surface>` (or `mark * <surface> <option>`) lists
// what every mark's audit of that surface shares, and `express *` what
// every Express function's (but its own options, `only`, which each lists:
// a shared entry would hold while one function dropped the option). Whatever an audit finds and api.json does not
// list fails, as does an entry the code no longer needs.

/** snake_case of a camelCase name, an acronym one word: yRight, y_right; toSVG, to_svg. */
const snake = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
const capitalized = (name) => name[0].toUpperCase() + name.slice(1);

/** How each surface spells a reference's name. */
const CONVENTIONS = {
  same: (name) => name,
  python: snake,
  react: (event) => `on${capitalized(event)}`,
  svelte: (event) => `on${event.toLowerCase()}`,
  widget: (event) => `on_${snake(event)}`,
  // Python's mark methods split a number from its word: point3d, point_3d.
  method: (type) => snake(type).replace(/(\d+)/g, "_$1"),
  // A handle's getX and setX are a widget's property x.
  property: (member) =>
    snake(member.replace(/^[gs]et(?=[A-Z])/, "").replace(/^./, (c) => c.toLowerCase())),
};

const KINDS = ["spelled", "spread", "without", "only", "choices", "untyped"];

/** `{ name: null }` for each name: options whose choices the surface's code does not type. */
const untyped = (names) => Object.fromEntries(names.map((name) => [name, null]));

const omit = (options, names) =>
  Object.fromEntries(Object.entries(options).filter(([name]) => !names.includes(name)));
const pick = (options, names) => Object.fromEntries(names.map((name) => [name, options[name]]));

/**
 * The audits the inventory makes: `{ name, reference, found, convention,
 * nested, foundNested }`, `nested` the settings of the reference's object
 * options and `foundNested` those of the surface's (where it types them).
 */
export function auditsOf(marks, options) {
  const audits = [];
  const add = (name, reference, found, { convention = "same", nested = {}, foundNested } = {}) =>
    audits.push({ name, reference, found, convention, nested, foundNested });
  const { python } = options;
  // The chart's options a function making a chart unpacks: HelperOptions's,
  // audited against the chart's as `chart helper`; none, for a function
  // taking no **options, is every one of them missing.
  const unpackedAudit = (name, typed) => {
    const unpacked = python.unpackedTypes[typed];
    add(name, python.helper, unpacked?.keywords ?? {}, {
      nested: python.nested.helper,
      foundNested: unpacked?.nested ?? {},
    });
  };
  // Each mark type's name in TypeScript and Python, as marks.json's rows map them.
  const named = (surface, strip = "") =>
    Object.fromEntries(
      Object.values(marks.rows)
        .filter(({ inventory }) => inventory?.spec && inventory[surface])
        .map(({ inventory }) => [inventory[surface].replace(strip, ""), null]),
    );
  const types = untyped(Object.keys(options.marks));
  add("names typescript", types, named("typescript"));
  add("names python", types, named("python", /^Chart\./), { convention: "method" });
  // A panel takes every mark the chart takes, by the same method.
  add("names panel", named("python", /^Chart\./), untyped(Object.keys(python.panelMethods)));
  for (const { inventory } of Object.values(marks.rows)) {
    // A mark function without a spec type of its own (custom) is audited by its name.
    const type = inventory?.spec ?? inventory?.typescript;
    if (!type || audits.some(({ name }) => name.startsWith(`mark ${type} `))) continue;
    const spec = options.marks[inventory.spec];
    const factory = options.factories[inventory.typescript];
    // A mark function takes its table first, apart from its options.
    const nested = options.marksNested[inventory.spec];
    if (spec && factory)
      add(`mark ${type} typescript`, omit(spec, ["data"]), factory, {
        nested,
        foundNested: options.factoriesNested[inventory.typescript],
      });
    const method = inventory.python?.replace(/^Chart\./, "");
    const keywords = python.methods[method];
    // A method marks.json names and Python lacks is the inventory check's to report.
    if (!spec || !keywords) continue;
    add(`mark ${type} python`, spec, keywords, {
      convention: "python",
      nested,
      foundNested: python.nested.methods[method],
    });
    if (python.panelMethods[method])
      add(`mark ${type} panel`, keywords, python.panelMethods[method], {
        nested: python.nested.methods[method],
        foundNested: python.nested.panelMethods[method],
      });
    // A helper takes its table first, as its chart's, and the chart's options in HelperOptions.
    if (inventory.helper) {
      const unpacked = python.unpacked.helpers[inventory.helper];
      add(
        `mark ${type} helper`,
        omit(keywords, ["data"]),
        omit(python.helpers[inventory.helper], ["data", `**${unpacked}`]),
        {
          nested: python.nested.methods[method],
          foundNested: python.nested.helpers[inventory.helper],
        },
      );
      unpackedAudit(`mark ${type} helper options`, unpacked);
    }
  }
  const events = options.events.typescript;
  // An adapter's listener props are the events audit's.
  const listeners = (props, adapter) =>
    omit(props, events.map(CONVENTIONS[adapter === "vue" ? "same" : adapter]));
  // Marks are audited mark by mark.
  add("chart typescript", options.chart.spec, options.chart.typescript, {
    nested: omit(options.chart.nested, ["marks"]),
    foundNested: omit(options.chart.typescriptNested, ["marks"]),
  });
  // An adapter takes onError as its error event's listener.
  const adapterOptions = omit(options.chart.typescript, ["onError"]);
  for (const adapter of ["react", "svelte"])
    add(`chart ${adapter}`, adapterOptions, listeners(options.chart[adapter], adapter));
  add("chart vue", adapterOptions, options.chart.vue);
  add("chart python", options.chart.spec, python.chart, {
    convention: "python",
    nested: options.chart.nested,
    foundNested: python.nested.chart,
  });
  // A live chart's options: TypeScript's update() and the widget's.
  add("chart update", options.chart.typescript, python.update, {
    convention: "python",
    nested: options.chart.typescriptNested,
    foundNested: python.nested.update,
  });
  add("chart helper", python.chart, python.helper, {
    nested: python.nested.chart,
    foundNested: python.nested.helper,
  });
  add("handle python", untyped(options.handle), untyped(python.widget), {
    convention: "property",
  });
  add("panel typescript", options.panel.spec, options.panel.typescript, {
    nested: options.panel.nested,
    foundNested: options.panel.typescriptNested,
  });
  for (const [surface, keywords, foundNested] of [
    ["python", python.panel, python.nested.panel],
    ["hg.Panel", python.panelClass, python.nested.panelClass],
  ])
    add(`panel ${surface}`, options.panel.spec, keywords, {
      convention: "python",
      nested: options.panel.nested,
      foundNested,
    });
  add("inset typescript", options.inset.spec, options.inset.typescript, {
    nested: options.inset.nested,
    foundNested: options.inset.typescriptNested,
  });
  add("inset python", { ...options.panel.spec, ...options.inset.spec }, python.inset, {
    convention: "python",
    nested: { ...options.panel.nested, ...options.inset.nested },
    foundNested: python.nested.inset,
  });
  for (const adapter of ["react", "svelte", "vue"])
    add(`events ${adapter}`, untyped(events), untyped(options.events[adapter]), {
      convention: adapter === "vue" ? "same" : adapter,
    });
  add("events python", untyped(events), untyped(python.events), { convention: "widget" });
  // A keyword the core's marks take, or several Express functions take,
  // means one thing in each: what the marks take for it, or else what most
  // of those functions take.
  const markMethods = Object.values(marks.rows).flatMap(
    ({ inventory }) => inventory?.python?.replace(/^Chart\./, "") ?? [],
  );
  const core = new Map();
  for (const method of new Set(markMethods))
    for (const [name, choices] of Object.entries(python.methods[method] ?? {}))
      core.set(name, [...new Set([...(core.get(name) ?? []), ...choices])].sort());
  const uses = new Map();
  for (const keywords of Object.values(python.express))
    for (const [name, choices] of Object.entries(keywords))
      if (!name.startsWith("**"))
        uses.set(name, [...(uses.get(name) ?? []), JSON.stringify(choices)]);
  const shared = {};
  for (const [name, given] of uses) {
    if (given.length < 2 && !core.has(name)) continue;
    const count = (choices) => given.filter((other) => other === choices).length;
    const most = given.reduce((a, b) => (count(b) > count(a) ? b : a));
    shared[name] = core.get(name) ?? JSON.parse(most);
  }
  for (const [name, keywords] of Object.entries(python.express)) {
    const takes = Object.keys(keywords).filter((key) => key in shared);
    add(`express ${name}`, pick(shared, takes), pick(keywords, takes));
  }
  const { seaborn } = python;
  for (const [name, unpacked] of Object.entries(python.unpacked.express)) {
    unpackedAudit(`express ${name} options`, unpacked);
    // Seaborn's function of the same name takes each keyword, in Express's words where api.json spells it.
    const keywords = Object.keys(python.express[name]).filter((key) => !key.startsWith("**"));
    add(`express ${name} seaborn`, untyped(seaborn.keywords[name] ?? []), untyped(keywords));
    const declared = seaborn.settings[name] ?? {};
    const held = python.nested.express[name];
    for (const keyword of new Set([...Object.keys(held), ...Object.keys(declared)])) {
      const settings = held[keyword] ?? { options: {}, nested: {} };
      const core = Object.values(python.nested.methods).flatMap((method) => method[keyword] ?? []);
      const audit = `express ${name} ${keyword}`;
      if (declared[keyword])
        // A keyword dict of seaborn's, typed: what seaborn's class it holds takes.
        add(audit, untyped(declared[keyword]), settings.options, {
          foundNested: settings.nested,
        });
      else if (core.some(({ type }) => type === settings.type)) continue;
      // Another class of a keyword the core's marks hold settings for; or else one of Express's own.
      else
        add(audit, core[0]?.options ?? {}, settings.options, {
          nested: core[0]?.nested ?? {},
          foundNested: settings.nested,
        });
    }
  }
  // A bare attribute in a Vue template (`<Line dodge />`) is true for the options a component flags.
  for (const [component, { flags, booleans }] of Object.entries(options.vueFlags))
    add(`vue flags ${component}`, untyped(booleans), untyped(flags));
  return audits;
}

/**
 * Whether a surface's choices for an option keep the reference's: alike
 * where the reference names its strings (or takes none), anything where it
 * takes any string, and unknown where the surface's code does not type them.
 */
function choicesAgree(reference, found) {
  if (reference === null || found === null || reference.includes("*")) return true;
  return reference.length === found.length && reference.every((choice, i) => choice === found[i]);
}

/** The audit naming what audits of one kind share: `mark * helper` for `mark line helper`, `express *` for `express histplot`. */
function sharedName(name) {
  const [scope, , ...rest] = name.split(" ");
  return ["mark", "express"].includes(scope) ? [scope, "*", ...rest].join(" ") : undefined;
}

/** The listed differences of an audit: its own, and those its kind shares (`sharedName`). */
function listedFor(api, name) {
  const shared = sharedName(name);
  return { own: api.audits[name] ?? {}, shared: (shared && api.audits[shared]) ?? {} };
}

/** Settings held by name (`keyed`) as a record of `named`'s options, spelled by `spell`, each holding them. */
function byName(keyed, named, spell) {
  const each = { ...keyed, keyed: false };
  const names = Object.keys(named.options);
  return {
    options: Object.fromEntries(names.map((option) => [spell(option), named.options[option]])),
    nested: Object.fromEntries(names.map((option) => [spell(option), each])),
  };
}

/** Whether settings are typed: they name settings, or a class with none (hg.IdentityScale) is their type. */
const typed = (held) =>
  held !== undefined && (Object.keys(held.options).length > 0 || held.type !== undefined);

/**
 * The audits of the settings of options both sides type, at any depth.
 * Settings of named types are audited once a pair, wherever they are met:
 * `settings TextStyle hg.TextStyle` (with `via`, where first met); others
 * by where they are: `chart python x ticks`, and for an option spread into
 * the surface's own options, `chart python interaction sync`.
 */
function settingsAudits(api, audits) {
  const settings = [];
  const pairs = new Map();
  const queue = audits.filter(({ foundNested }) => foundNested);
  while (queue.length > 0) {
    const { name, via, reference, convention, nested, foundNested } = queue.shift();
    const { own, shared } = listedFor(api, name);
    const listed = (kind, option) => own[kind]?.[option] ?? shared[kind]?.[option];
    const add = (ours, theirs, path) => {
      if (!typed(ours) || !typed(theirs)) return;
      // Settings by name on one side (Python's limits={"x": ...}) stand for a record of the
      // other side's names (in the surface's spelling), each holding them.
      if (theirs.keyed && !ours.keyed) theirs = byName(theirs, ours, CONVENTIONS[convention]);
      else if (ours.keyed && !theirs.keyed) ours = byName(ours, theirs, (setting) => setting);
      const where = [via ?? name, ...path].join(" ");
      const audit = {
        name: where,
        reference: ours.options,
        found: theirs.options,
        convention,
        nested: ours.nested,
        foundNested: theirs.nested,
      };
      if (ours.type && theirs.type) {
        // A pair of names met again with other settings (two types of one name) is audited where it is.
        const pair = `settings ${ours.type} ${theirs.type}`;
        const content = JSON.stringify([ours, theirs]);
        const met = pairs.get(pair);
        if (met?.content === content) {
          met.audit.paths.push(where);
          return;
        }
        if (!met) {
          Object.assign(audit, { name: pair, via: where, paths: [where] });
          pairs.set(pair, { content, audit });
        }
      }
      settings.push(audit);
      queue.push(audit);
    };
    for (const option of Object.keys(reference)) {
      if (listed("without", option)) continue;
      const spread = listed("spread", option);
      if (spread)
        for (const [setting, held] of Object.entries(nested[option]?.nested ?? {})) {
          const spelled =
            spread.as?.[setting] ?? `${spread.prefix ?? ""}${CONVENTIONS[convention](setting)}`;
          if (!spread.without?.[setting]) add(held, foundNested[spelled], [option, setting]);
        }
      else {
        const spelling = listed("spelled", option)?.as ?? CONVENTIONS[convention](option);
        add(nested[option], foundNested[spelling], [option]);
      }
    }
  }
  return settings;
}

/** Errors where an audit finds a difference api.json does not list, or api.json lists what is not so. */
export function checkApi(api, found) {
  const errors = [];
  const audits = [...found, ...settingsAudits(api, found)];
  const names = new Set(audits.map(({ name }) => name));
  const sharedUse = new Map();
  for (const [name, listed] of Object.entries(api.audits)) {
    const at = `api.json audits["${name}"]`;
    const shared = name.split(" ")[1] === "*";
    if (shared && !audits.some((audit) => sharedName(audit.name) === name))
      errors.push(`${at}: no audit is of that kind; drop it`);
    else if (!shared && !names.has(name)) errors.push(`${at}: no such audit; drop it`);
    for (const [kind, entries] of Object.entries(listed)) {
      if (!KINDS.includes(kind)) {
        errors.push(`${at}.${kind}: not a kind of difference; use ${KINDS.join(", ")}`);
        continue;
      }
      for (const [option, entry] of Object.entries(entries)) {
        const reason = typeof entry === "string" ? entry : entry?.reason;
        if (typeof reason !== "string" || !reason)
          errors.push(`${at}.${kind}.${option}: give the reason`);
        // One function dropping an option a shared entry lists would leave it needed by the others.
        if (shared && kind === "only" && name.startsWith("express "))
          errors.push(
            `${at}.only.${option}: an Express function's own options are its own; list ${option} in each function's audit`,
          );
        if (shared) sharedUse.set([name, kind, option].join("\0"), false);
      }
    }
  }
  for (const audit of audits) {
    const found = checkAudit(audit, listedFor(api, audit.name), sharedUse);
    errors.push(...(audit.via ? found.map((error) => `${error} (met at ${audit.via})`) : found));
  }
  for (const [entry, used] of sharedUse)
    if (!used) {
      const [name, kind, option] = entry.split("\0");
      errors.push(`api.json audits["${name}"].${kind}.${option}: no audit needs it; drop it`);
    }

  return errors;
}

function checkAudit(
  { name, reference, found, nested, foundNested, convention },
  { own, shared },
  sharedUse,
) {
  const errors = [];
  const at = `api.json audits["${name}"]`;
  /** The entry of `kind` for `option`, its own or the shared one (marking that used). */
  const entryOf = (kind, option) => {
    if (own[kind] && option in own[kind]) return own[kind][option];
    if (shared[kind] && option in shared[kind]) {
      sharedUse.set([sharedName(name), kind, option].join("\0"), true);
      return shared[kind][option];
    }
    return undefined;
  };
  const spell = CONVENTIONS[convention];
  const used = new Set();
  /**
   * Expects `spelling` among the surface's options, with choices that keep
   * `choices`, and its settings typed where `held` types them, or else
   * typed on neither side.
   */
  const expect = (option, spelling, choices, location, held) => {
    if (!(spelling in found)) {
      errors.push(
        `${name}: no ${spelling} for ${location}; add it, or list ${option} in ${at}.without with the reason`,
      );
      return;
    }
    used.add(spelling);
    if (foundNested && typed(held) !== typed(foundNested[spelling])) {
      if (entryOf("untyped", location) === undefined)
        errors.push(
          `${name} ${spelling}: ${location}'s settings are typed on ${typed(held) ? "the reference" : "the surface"} alone; type them on the other side, or give the reason in ${at}.untyped["${location}"]`,
        );
    } else if (own.untyped && location in own.untyped)
      errors.push(
        `${name} ${spelling}: ${location}'s settings are typed on ${foundNested && typed(held) ? "both sides" : "neither side"}; drop ${at}.untyped["${location}"]`,
      );
    // A listed difference of choices counts as needed only where the choices differ,
    // and holds only for the choices it lists.
    const takes = found[spelling];
    if (choicesAgree(choices, takes)) {
      if (own.choices && option in own.choices)
        errors.push(`${name} ${spelling}: the choices agree; drop ${at}.choices.${option}`);
      return;
    }
    const listed = entryOf("choices", option);
    if (listed === undefined)
      errors.push(
        `${name} ${spelling}: choices ${JSON.stringify(takes)} where ${location} has ${JSON.stringify(choices)}; make them one, or give the reason in ${at}.choices.${option}`,
      );
    else if (
      !Array.isArray(listed.takes) ||
      JSON.stringify([...listed.takes].sort()) !== JSON.stringify([...takes].sort())
    )
      errors.push(
        `${name} ${spelling}: choices ${JSON.stringify(takes)} where ${own.choices && option in own.choices ? at : `api.json audits["${sharedName(name)}"]`}.choices.${option} takes ${JSON.stringify(listed.takes ?? null)}; list them there, or take ${location}'s`,
      );
  };
  for (const [option, choices] of Object.entries(reference)) {
    const without = entryOf("without", option) !== undefined;
    const spread = entryOf("spread", option);
    const spelling = entryOf("spelled", option)?.as ?? spell(option);
    if (without) {
      if (spelling in found)
        errors.push(`${name}: takes ${spelling}, which ${at}.without lists; drop it there`);
    } else if (spread) {
      const settings = nested[option];
      if (!typed(settings)) {
        errors.push(`${at}.spread.${option}: ${option} has no settings to spread; drop it`);
        continue;
      }
      for (const [setting, settingChoices] of Object.entries(settings.options)) {
        if (spread.without && setting in spread.without) continue;
        const spelled = spread.as?.[setting] ?? `${spread.prefix ?? ""}${spell(setting)}`;
        expect(option, spelled, settingChoices, `${option}.${setting}`, settings.nested[setting]);
      }
      for (const setting of Object.keys({ ...spread.as, ...spread.without }))
        if (!(setting in settings.options))
          errors.push(`${at}.spread.${option}: ${option} has no ${setting}; drop it`);
    } else expect(option, spelling, choices, option, nested[option]);
  }
  for (const kind of ["spelled", "spread", "without", "choices", "untyped"])
    for (const option of Object.keys(own[kind] ?? {}))
      if (!(option.split(".")[0] in reference))
        errors.push(`${at}.${kind}.${option}: no such option; drop it`);
  for (const option of Object.keys(found))
    if (!used.has(option) && entryOf("only", option) === undefined)
      errors.push(
        `${name}: ${option} is not the reference's; list it in ${at}.only with the reason`,
      );
  for (const option of Object.keys(own.only ?? {}))
    if (!(option in found) || used.has(option))
      errors.push(`${at}.only.${option}: not the surface's own; drop it`);
  return errors;
}
