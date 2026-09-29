import assert from "node:assert/strict";
import test from "node:test";

import {
  accountForHeading,
  bulletHasCitation,
  evaluatePlans,
  isDocsOrAgents,
} from "./check-plan-structure.mjs";

const planPath = ".agents/specs/1-example/plan.md";

function plan(after, before = null) {
  return { path: planPath, before, after };
}

function basePlan(extra = "") {
  return `# Title

## What exists

- The route exists. \`path: packages/api/app/Example.php:1\`

## Open decisions

None — every choice is made.

## Invariants

- Old contract stays. A wrong change drops it. Proof: \`path: packages/api/tests/ExampleTest.php\` assertion \`test_old\`.
- After chunk A, main still works without the next chunk. Proof: the test above.

## Chunks

### Chunk A: work

- **Done when:** the test above passes
${extra}`;
}

test("a plan with the required sections passes", () => {
  assert.deepEqual(evaluatePlans({ plans: [plan(basePlan())], diffPaths: [planPath] }), []);
});

test("a changed plan must name Invariants and Open decisions", () => {
  const errors = evaluatePlans({
    plans: [plan("# Title\n\n## Chunks\n\n### Chunk A: work\n\n- **Done when:** ship it\n")],
    diffPaths: [planPath],
  });
  assert.ok(errors.some((error) => error.includes("missing ## Invariants")));
  assert.ok(errors.some((error) => error.includes("missing ## Open decisions")));
});

test("Invariants None fails when the diff leaves docs and .agents", () => {
  const after = `# Title

## Open decisions

None — docs only.

## Invariants

None — documentation wording only.
`;
  const errors = evaluatePlans({
    plans: [plan(after)],
    diffPaths: [planPath, "tools/check-plan-structure.mjs"],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Invariants is None/);
});

test("Invariants None passes when the diff stays in docs and .agents", () => {
  const after = `# Title

## Open decisions

None — docs only.

## Invariants

None — documentation wording only.
`;
  assert.deepEqual(
    evaluatePlans({
      plans: [plan(after)],
      diffPaths: [planPath, "docs/readme.md"],
    }),
    [],
  );
});

test("deferral markers fail inside a chunk and prefer does not", () => {
  const tbd = evaluatePlans({
    plans: [plan(basePlan("- **Verify with:** decide later\n"))],
    diffPaths: [planPath],
  });
  assert.ok(tbd.some((error) => error.includes("deferral marker")));

  const prefer = evaluatePlans({
    plans: [plan(basePlan("- **Done when:** prefer the owner copy\n"))],
    diffPaths: [planPath],
  });
  assert.deepEqual(prefer, []);
});

test("deferral markers inside Open decisions do not fail the chunk scan", () => {
  const after = basePlan().replace(
    "None — every choice is made.",
    "- [ ] `chunk-a` TBD until the contract is read",
  );
  assert.deepEqual(evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] }), []);
});

test("a disappeared heading must be named, and a rename must point at a real heading", () => {
  const before = `${basePlan()}\n## Alpha\n`;
  const missing = evaluatePlans({
    plans: [plan(basePlan(), before)],
    diffPaths: [planPath],
  });
  assert.ok(missing.some((error) => error.includes('"Alpha" disappeared')));

  const renamed = `${basePlan()}\n## Gamma\n\n## Removed since previous revision\n\n- renamed Alpha → Gamma\n`;
  assert.deepEqual(
    evaluatePlans({ plans: [plan(renamed, before)], diffPaths: [planPath] }),
    [],
  );

  const dangling = `${basePlan()}\n## Removed since previous revision\n\n- renamed Alpha → Missing\n`;
  const danglingErrors = evaluatePlans({
    plans: [plan(dangling, before)],
    diffPaths: [planPath],
  });
  assert.ok(danglingErrors.some((error) => error.includes("not a heading")));
});

test("keeping the old heading text outside the removed note does not account for it", () => {
  const before = "## Alpha\n";
  const after = "## Beta\n\nAlpha is still mentioned here.\n";
  const errors = evaluatePlans({ plans: [plan(after, before)], diffPaths: [planPath] });
  assert.ok(errors.some((error) => error.includes('"Alpha" disappeared')));
});

test("What exists accepts a link, path:, a blockquote, or a code block", () => {
  const cases = [
    "- See [the issue](https://example.com/issues/1)\n",
    "- See the file. `path: packages/api/app/Example.php:4`\n",
    "- Issue body:\n\n  > not planned\n",
    "- Command:\n\n  ```\n  gh issue view 1\n  ```\n",
  ];
  for (const bullet of cases) {
    const after = `# Title\n\n## What exists\n\n${bullet}\n## Open decisions\n\nNone — done.\n\n## Invariants\n\n- Stays. Proof: \`path: a.test.js\` assertion \`test_stays\`.\n`;
    assert.deepEqual(evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] }), [], bullet);
  }
});

test("a What exists bullet with only a bare issue number fails", () => {
  const after = `# Title

## What exists

- #568 depends on #566

## Open decisions

None — done.

## Invariants

- Stays. Proof: \`path: a.test.js\` assertion \`test_stays\`.
`;
  const errors = evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] });
  assert.ok(errors.some((error) => error.includes("What exists bullet")));
});

test("a new file does not require a removed-heading note", () => {
  assert.deepEqual(evaluatePlans({ plans: [plan(basePlan(), null)], diffPaths: [planPath] }), []);
});

test("docs and agents paths are the only None exception", () => {
  assert.equal(isDocsOrAgents("docs/guide.md"), true);
  assert.equal(isDocsOrAgents(".agents/specs/1-example/plan.md"), true);
  assert.equal(isDocsOrAgents("packages/api/app/Example.php"), false);
});

test("the spec template is not linted, and a copy of it is", () => {
  const unfilled = `# Title

## What exists

- Claim. \`path: path/to/file.ext:1\`

### Chunk A: work

- **Done when:** TBD
`;
  const templatePath = ".agents/specs/_template/plan.md";
  assert.deepEqual(
    evaluatePlans({
      plans: [{ path: templatePath, before: null, after: unfilled }],
      diffPaths: [templatePath, "package.json"],
    }),
    [],
  );
  const copied = evaluatePlans({
    plans: [{ path: planPath, before: null, after: unfilled }],
    diffPaths: [planPath],
  });
  assert.ok(copied.some((error) => error.includes("What exists bullet")));
  assert.ok(copied.some((error) => error.includes("missing ## Invariants")));
  assert.ok(copied.some((error) => error.includes("deferral marker")));
});

test("a path/to placeholder is not a citation", () => {
  const after = `# Title

## What exists

- The route exists. \`path: path/to/file.ext:1\`

## Open decisions

None — done.

## Invariants

- Stays. Proof: \`path: packages/api/tests/ExampleTest.php\` assertion \`test_stays\`.
`;
  const errors = evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] });
  assert.ok(errors.some((error) => error.includes("What exists bullet")));
});

test("deferral markers are case-sensitive for TODO", () => {
  const errors = evaluatePlans({
    plans: [plan(basePlan("- **Done when:** the todo list stays\n"))],
    diffPaths: [planPath],
  });
  assert.deepEqual(errors, []);
});

test("CI without a merge base fails closed", async () => {
  const { ciBaseError } = await import("./check-plan-structure.mjs");
  assert.equal(typeof ciBaseError, "function");
  assert.match(ciBaseError("HEAD", { CI: "true" }), /base branch/);
  assert.equal(ciBaseError("HEAD", {}), null);
  assert.equal(ciBaseError("abc123", { CI: "true" }), null);
});

test("a removal line needs a why", () => {
  assert.equal(
    accountForHeading("Alpha", "- Alpha\n", ["Beta"]).ok,
    false,
  );
  assert.equal(
    accountForHeading("Alpha", "- Alpha — folded into Beta\n", ["Beta"]).ok,
    true,
  );
  assert.equal(bulletHasCitation({ line: "- just words", nested: [] }), false);
});

function invariantsPlan(bullets) {
  return `# Title

## Open decisions

None — done.

## Invariants

${bullets}
`;
}

/** @param {string} line */
function proofError(line) {
  return `${planPath}: invariant needs a test path: or cmd: after Proof: ${line}`;
}

test("an invariant with Proof and no citation fails", () => {
  const line = "- Stays. Proof: route-click tests.";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), [
    proofError(line),
  ]);
});

test("an invariant path/to placeholder fails", () => {
  const line = "- Stays. Proof: `path: path/to/x.test.ts`";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), [
    proofError(line),
  ]);
});

test("an invariant citation of a non-test file fails", () => {
  const line = "- Stays. Proof: `path: packages/apps/src/foo.ts`";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), [
    proofError(line),
  ]);
});

test("an invariant command after Proof passes", () => {
  const line = "- Stays. Proof: `cmd: pnpm test`";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), []);
});

test("an empty invariant command fails", () => {
  const line = "- Stays. Proof: `cmd:`";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), [
    proofError(line),
  ]);
});

test("an invariant command placeholder fails", () => {
  const line = "- Stays. Proof: `cmd: <command>`";
  assert.deepEqual(evaluatePlans({ plans: [plan(invariantsPlan(line))], diffPaths: [planPath] }), [
    proofError(line),
  ]);
});

test("an invariant proof on a nested line counts", () => {
  const after = invariantsPlan(`- Old contract stays.
  Proof: \`path: packages/apps/src/mail.test.tsx\``);
  assert.deepEqual(evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] }), []);
});

test("invariant proofs accept stories, phpunit, tests, spec, and e2e paths", () => {
  const after = invariantsPlan(`- Stories. Proof: \`path: packages/apps/src/mail.stories.tsx\`
- PHPUnit. Proof: \`path: packages/api/tests/Feature/ExampleTest.php\`
- Directory. Proof: \`path: packages/api/tests/Feature/Something.php\`
- Spec. Proof: \`path: packages/apps/src/mail.spec.ts\`
- End to end. Proof: \`path: e2e/smoke.ts\``);
  assert.deepEqual(evaluatePlans({ plans: [plan(after)], diffPaths: [planPath] }), []);
});
