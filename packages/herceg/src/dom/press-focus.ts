// Focus a press moves into a chart, or keeps there, draws no focus ring
// until a key is pressed there. A press's handlers take the focus
// themselves where they keep the press's own default (text selection) from
// it, and browsers draw the ring (`:focus-visible`) for focus a script
// moves. So the chart's root, or a part of the chart's own (a navigator's
// slider, which says so with an empty attribute), takes an attribute that a
// rule of Herceg's matches: "pointer" draws no outline; "keyboard", once a
// key that is not a modifier is pressed, the browser's ring where it would
// draw none itself. It is emptied when the element loses the focus. Both
// rules weigh as an attribute and `:focus` do, (0,2,0), and follow the
// page's style and link elements: they win over resets such as
// `:focus { outline: none }`, and lose to the page's more specific
// selectors and to `!important`. Elements of the application's in the
// chart keep the rings the page and the browser give them. The interaction
// controller, which takes presses, watches for them; before it loads, the
// chart focuses for a press it holds with `focusVisible: false`, which
// draws no ring for that focus; the input held is not read for rings.

const FOCUS = "data-herceg-focus";
const MODIFIERS = ["Shift", "Control", "Alt", "AltGraph", "Meta"];
const RULES = `[${FOCUS}=pointer]:focus{outline-style:none}[${FOCUS}=keyboard]:focus:where(:not(:focus-visible)){outline:auto}`;

/**
 * The rules, made for each document a chart is pressed in (a document
 * adopts only sheets its own window made, and a frame's window outlives
 * the documents it navigates through), adopted by it or the shadow roots
 * in it, and left there: they match nothing without the attribute. Sheets
 * of their own, as a policy forbidding style elements allows.
 */
const sheets = new WeakMap<Document, CSSStyleSheet>();

/** Marks `element`, which a press focused or kept focused, as drawing no ring until a key. */
export function pressed(element: HTMLElement): void {
  const scope = element.getRootNode() as Document | ShadowRoot;
  const document = element.ownerDocument;
  const view = document.defaultView;
  if (scope.activeElement !== element || !view) return;
  try {
    let sheet = sheets.get(document);
    if (!sheet) {
      sheet = new view.CSSStyleSheet();
      sheet.replaceSync(RULES);
      sheets.set(document, sheet);
    }
    if (!scope.adoptedStyleSheets.includes(sheet))
      scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
    element.setAttribute(FOCUS, "pointer");
  } catch {
    // A browser without constructed sheets: the browser's ring shows.
  }
}

/**
 * Watches presses on a chart's `root`: what one leaves focused there, the
 * root or a part of the chart's own, draws no ring until a key. Returns
 * what stops it.
 */
export function pressFocus(root: HTMLElement): () => void {
  // A press being dispatched, with what it does by default (the focus a mouse press gives).
  let pressing: ReturnType<typeof setTimeout> | undefined;
  // An element of any window's: a frame's document may hold the chart.
  const own = (element: EventTarget | null): element is HTMLElement =>
    element === root ||
    ((element as Element | null)?.nodeType === 1 && (element as Element).hasAttribute(FOCUS));
  const listeners: Record<string, (event: Event) => void> = {
    pointerdown: () => {
      const focused = (root.getRootNode() as Document | ShadowRoot).activeElement;
      if (own(focused) && root.contains(focused)) pressed(focused);
      clearTimeout(pressing);
      pressing = setTimeout(() => (pressing = undefined));
    },
    focusin: ({ target }) => {
      if (pressing !== undefined && own(target)) pressed(target);
    },
    keydown: (event) => {
      const element = event.target as Element;
      if (element.getAttribute(FOCUS) && !MODIFIERS.includes((event as KeyboardEvent).key))
        element.setAttribute(FOCUS, "keyboard");
    },
    focusout: ({ target }) => {
      if (own(target)) target.setAttribute(FOCUS, "");
    },
  };
  for (const [type, listener] of Object.entries(listeners))
    root.addEventListener(type, listener, true);
  return () => {
    clearTimeout(pressing);
    for (const [type, listener] of Object.entries(listeners))
      root.removeEventListener(type, listener, true);
  };
}
