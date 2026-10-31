// Imported by tests whose charts take input as soon as they are mounted, as
// charts do once one on the page has loaded its interaction controller and
// picking. deferred.test.ts tests the input that arrives before they have.

import { loadInteraction } from "../../src/dom/chart.ts";
import { loadPicking } from "../../src/dom/interaction.ts";

await loadInteraction();
await loadPicking();
