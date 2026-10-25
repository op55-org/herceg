// The source a test run ran on, so that the contract check reads only
// reports of the tree it checks: the commit, and a hash of how the tree
// differs from it (tracked changes and deletions, and files git does not
// ignore). The generated capability docs are left out: writing them from a
// run must not make that run's reports stale.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository's root directory. */
export const root = fileURLToPath(new URL("../..", import.meta.url));

/** Files the fingerprint leaves out: what scripts/generate-capabilities.mjs writes. */
export const GENERATED = ["docs/capabilities.md", "docs/capabilities.json"];

const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30, encoding: "buffer" });

/** `{ revision, sourceHash }`: the commit checked out, and a hash of the changes over it. */
export function sourceState() {
  const revision = git("rev-parse", "HEAD").toString().trim();
  const excluded = GENERATED.map((file) => `:(exclude)${file}`);
  const hash = createHash("sha256").update(git("diff", "HEAD", "--binary", "--", ".", ...excluded));
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...excluded);
  for (const file of untracked.toString().split("\0").filter(Boolean).sort())
    hash.update(`\0${file}\0`).update(readFileSync(join(root, file)));
  return { revision, sourceHash: hash.digest("hex") };
}

/** Where the runs of a source keep their reports: tmp/contracts/<revision>-<hash>/. */
export function runDirectory({ revision, sourceHash }) {
  return join(root, "tmp", "contracts", `${revision.slice(0, 12)}-${sourceHash.slice(0, 12)}`);
}
