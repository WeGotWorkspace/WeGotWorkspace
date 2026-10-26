import assert from "node:assert/strict";
import test from "node:test";

import {
  epicOf,
  evaluateArchitectureDocs,
  isArchitectureDoc,
  isSourceHeader,
} from "./check-architecture-spec.mjs";

const docPath = "docs/architecture/live-updates.md";
const goodSpec = { dir: "1659-live-updates", firstLine: "Source: #1659 (body-hash: 0a1b2c3d)" };

/** @param {string} text */
function doc(text, path = docPath) {
  return { path, text };
}

test("a new Epic doc with a matching spec passes", () => {
  assert.deepEqual(
    evaluateArchitectureDocs({
      addedDocs: [doc("# Live updates\n\nStatus: proposal. Epic: #1659.\n")],
      specs: [goodSpec],
    }),
    [],
  );
});

test("a new Epic doc without a spec folder fails and points at plan-feature", () => {
  const errors = evaluateArchitectureDocs({
    addedDocs: [doc("# Live updates\n\nEpic: #1659.\n")],
    specs: [{ dir: "741-suite-notify", firstLine: "Source: #741 (body-hash: fd7d2b61)" }],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Epic #1659/);
  assert.match(errors[0], /\.agents\/specs\/1659-<slug>\/spec\.md is missing/);
  assert.match(errors[0], /plan-feature/);
});

test("a spec folder whose number only shares a prefix does not count", () => {
  const errors = evaluateArchitectureDocs({
    addedDocs: [doc("Epic: #165.\n")],
    specs: [goodSpec],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /165-<slug>/);
});

test("a spec folder without spec.md fails", () => {
  const errors = evaluateArchitectureDocs({
    addedDocs: [doc("Epic: #1659.\n")],
    specs: [{ dir: "1659-live-updates", firstLine: null }],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /does not start with "Source: #1659/);
});

test("a spec with an ad-hoc, placeholder, or other-issue Source fails", () => {
  for (const firstLine of [
    "Source: ad-hoc",
    "Source: #1659 (body-hash: xxxxxxxx)",
    "Source: #1660 (body-hash: 0a1b2c3d)",
    "# Live updates",
  ]) {
    const errors = evaluateArchitectureDocs({
      addedDocs: [doc("Epic: #1659.\n")],
      specs: [{ dir: "1659-live-updates", firstLine }],
    });
    assert.equal(errors.length, 1, firstLine);
    assert.match(errors[0], /body-hash/, firstLine);
  }
});

test("a Source header may carry trailing context", () => {
  assert.equal(
    isSourceHeader(452, "Source: #452 (body-hash: 9f8e7d6c). Parent epic: #435."),
    true,
  );
});

test("one good spec folder is enough when two share the number", () => {
  assert.deepEqual(
    evaluateArchitectureDocs({
      addedDocs: [doc("Epic: #1659.\n")],
      specs: [{ dir: "1659-old-draft", firstLine: "Source: ad-hoc" }, goodSpec],
    }),
    [],
  );
});

test("a new doc that names no Epic is not checked", () => {
  assert.deepEqual(
    evaluateArchitectureDocs({
      addedDocs: [doc("# Conformance\n\nTracked under Goal Product#138 and Task #1392.\n")],
      specs: [],
    }),
    [],
  );
});

test("files outside docs/architecture are not checked", () => {
  assert.deepEqual(
    evaluateArchitectureDocs({
      addedDocs: [
        doc("Epic: #1659.\n", "docs/product/live-updates.md"),
        doc("Epic: #1659.\n", "docs/architecture/diagram.svg"),
      ],
      specs: [],
    }),
    [],
  );
  assert.equal(isArchitectureDoc("docs/architecture/notes.md"), true);
  assert.equal(isArchitectureDoc("./docs/architecture/notes.md"), true);
  assert.equal(isArchitectureDoc("packages/api/docs/architecture/notes.md"), false);
});

test("Epic reference shapes used in docs/architecture are recognised", () => {
  assert.equal(epicOf("Status: proposal. Epic: #1659 (Goals Product#149)."), 1659);
  assert.equal(
    epicOf("**Tracker:** [Goal Product#88](https://x) · **Epic:** [#662](https://x/662)"),
    662,
  );
  assert.equal(epicOf("Tracker: Epic [#741](https://x/741). Product Goals: …"), 741);
  assert.equal(epicOf("Goal [Product#138](https://x), Epic #1391, A0 #1392."), 1391);
});

test("the first Epic named is the doc's Epic, and later ones are background", () => {
  const text = `# Notifications

Epic: #1659 (Goals Product#149).

It builds on the Web Push decisions of Epic #1600.
`;
  assert.equal(epicOf(text), 1659);
  assert.deepEqual(
    evaluateArchitectureDocs({ addedDocs: [doc(text)], specs: [goodSpec] }),
    [],
  );
});

test("an Epic inside a code fence is ignored", () => {
  assert.equal(epicOf("```\nEpic: #1\n```\n\nNo tracker yet.\n"), null);
  assert.equal(epicOf("```text\nEpic: #1\n```\n\nEpic: #2\n"), 2);
});

test("words that only contain Epic are not a reference", () => {
  assert.equal(epicOf("Epics #12 and #13 are related. Epicurean #4."), null);
});
