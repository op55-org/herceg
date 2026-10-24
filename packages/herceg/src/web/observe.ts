// Fragments as a page gets them: the hosts in it when it loads, and those
// inserted later (an HTMX swap, say), each mounted once; a host removed is
// unmounted, unless it was only moved, and one whose content was replaced
// is mounted afresh. One observer watches every root observed, so what a
// host's change does never depends on which root heard of it first.

import { emptied, isMounted, mount, unmount } from "./mount.ts";

const HOST = "[data-herceg]";
const RUNTIME = "[data-herceg-runtime]";
const WATCH = { childList: true, subtree: true };

/** The roots observed, each with how many `observe` calls hold it. */
const roots = new Map<Document | Element, number>();
/**
 * The mounted hosts found in them: true for those mounted by observing,
 * false for those the page mounted itself, which observing unmounts when
 * removed but never mounts again.
 */
const hosts = new Map<Element, boolean>();
let observer: MutationObserver | undefined;

/**
 * Mounts every fragment host in `root` (the root too, if it is one) and
 * those added to it later, and unmounts those removed from it (also those
 * the page mounted itself). Returns what stops observing it and unmounts
 * the hosts observing mounted that no observed root holds then.
 */
export function observe(root: Document | Element = document): () => void {
  roots.set(root, (roots.get(root) ?? 0) + 1);
  observer ??= new MutationObserver(changed);
  observer.observe(root, WATCH);
  visit(root instanceof Document ? root.documentElement : root);
  let stopped = false;
  return () => {
    if (stopped || !observer) return;
    stopped = true;
    // What happened under the roots so far, as they were.
    changed(observer.takeRecords());
    const count = roots.get(root)! - 1;
    if (count > 0) roots.set(root, count);
    else roots.delete(root);
    // An observer leaves all its targets at once: it watches the rest again.
    observer.disconnect();
    for (const kept of roots.keys()) observer.observe(kept, WATCH);
    reconcile();
  };
}

function visit(node: Node) {
  if (!(node instanceof Element)) return;
  for (const host of [...(node.matches(HOST) ? [node] : []), ...node.querySelectorAll(HOST)]) {
    if (!(host instanceof HTMLElement) || hosts.has(host)) continue;
    const mine = !isMounted(host);
    hosts.set(host, mine);
    // A failure shows in the host and reaches the page as an event.
    if (mine) mount(host).catch(() => {});
  }
}

function changed(records: MutationRecord[]) {
  let removed = false;
  for (const record of records) {
    // Charts drawing change nothing of the fragments.
    if (record.target instanceof Element && record.target.closest(RUNTIME)) continue;
    for (const node of record.addedNodes) visit(node);
    removed ||= record.removedNodes.length > 0;
  }
  if (removed) reconcile();
}

/**
 * Unmounts the hosts no observed root holds (of those the page mounted,
 * only the ones gone from the page), and mounts afresh those whose content
 * was replaced. Records arrive after the changes that made them: a
 * host moved within the roots is back in one by now, and keeps its chart.
 */
function reconcile() {
  for (const [host, mine] of hosts) {
    if (![...roots.keys()].some((root) => root.contains(host))) {
      hosts.delete(host);
      // The page's own charts go when their hosts leave the page, not when
      // observing stops.
      if (mine || !host.isConnected) unmount(host);
    } else if (emptied(host)) {
      unmount(host);
      if (mine) mount(host as HTMLElement).catch(() => {});
      else hosts.delete(host);
    }
  }
}
