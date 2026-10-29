import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluate,
  formatBaseline,
  HOOK_SIZE_RULE,
  hookKey,
  isOverLimit,
  LIMITS,
  measureHooks,
  nextBaseline,
  parseBaseline,
} from "./hook-size-ratchet.mjs";

const limits = { lines: 200, effects: 4 };
const hookPath = "packages/apps/src/demo/use-demo.ts";

function row(name, lines, effects, reason = "grandfathered") {
  return { key: hookKey(hookPath, name), lines, effects, reason };
}

function measured(entries) {
  return new Map(
    entries.map(([name, lines, effects]) => [hookKey(hookPath, name), { lines, effects }]),
  );
}

function byName(text, fileName) {
  return Object.fromEntries(
    measureHooks(text, fileName).map((hook) => [
      hook.name,
      { lines: hook.lines, effects: hook.effects },
    ]),
  );
}

test("limits are 200 body lines and 4 effects", () => {
  assert.deepEqual({ ...LIMITS }, limits);
  assert.equal(isOverLimit({ lines: 200, effects: 4 }), false);
  assert.equal(isOverLimit({ lines: 201, effects: 0 }), true);
  assert.equal(isOverLimit({ lines: 10, effects: 5 }), true);
});

test("rule sentence names both limits and the shrink case", () => {
  assert.match(HOOK_SIZE_RULE, /over 200 lines/);
  assert.match(HOOK_SIZE_RULE, /more than 4 `useEffect`/);
  assert.match(HOOK_SIZE_RULE, /baseline was not lowered/);
});

test("measures an exported function declaration: body lines include both braces", () => {
  const text = ["export function useDemo() {", "  const a = 1;", "  return a;", "}"].join("\n");
  assert.deepEqual(byName(text), { useDemo: { lines: 4, effects: 0 } });
});

test("measures exported const arrow and function expressions", () => {
  const text = [
    "export const useArrow = () => {",
    "  return 1;",
    "};",
    "export const useExpr = function () {",
    "  return 2;",
    "};",
    "export const useWrapped = ((x: number) => {",
    "  return x;",
    "}) as (x: number) => number;",
    "export const useInline = () => 1;",
  ].join("\n");
  assert.deepEqual(byName(text), {
    useArrow: { lines: 3, effects: 0 },
    useExpr: { lines: 3, effects: 0 },
    useInline: { lines: 1, effects: 0 },
    useWrapped: { lines: 3, effects: 0 },
  });
});

test("ignores non-exported hooks, non-hook names, and overload signatures", () => {
  const text = [
    "function useLocal() { return 1; }",
    "export function user() { return 1; }",
    "export function useless() { return 1; }",
    "export function helper() { return 1; }",
    "export const useValue = 3;",
    "export function useOverloaded(a: string): string;",
    "export function useOverloaded(a: number): number;",
    "export function useOverloaded(a: unknown) {",
    "  return a;",
    "}",
  ].join("\n");
  assert.deepEqual(byName(text), { useOverloaded: { lines: 3, effects: 0 } });
});

test("counts a hook exported through a local export list under its exported name", () => {
  const text = [
    "function useInner() {",
    "  useEffect(() => {}, []);",
    "}",
    "const useOther = () => {};",
    "export { useInner, useOther as useRenamed };",
    "export type { Foo } from './foo';",
  ].join("\n");
  assert.deepEqual(byName(text), {
    useInner: { lines: 3, effects: 1 },
    useRenamed: { lines: 1, effects: 0 },
  });
});

test("counts useEffect and useLayoutEffect, bare or on React, including nested calls", () => {
  const text = [
    "import React, { useEffect, useLayoutEffect } from 'react';",
    "export function useEffects() {",
    "  useEffect(() => {}, []);",
    "  React.useEffect(() => {}, []);",
    "  useLayoutEffect(() => {}, []);",
    "  React.useLayoutEffect(() => {}, []);",
    "  useInsertionEffect(() => {});",
    "  useMemo(() => 1, []);",
    "  const nested = () => { useEffect(() => {}); };",
    "  // useEffect(() => {}) in a comment does not count",
    "  const text = 'useEffect(';",
    "  return nested;",
    "}",
  ].join("\n");
  assert.equal(byName(text).useEffects.effects, 5);
});

test("parses TSX hooks that return JSX", () => {
  const text = [
    "export function useBadge() {",
    '  return <span className="badge">{1}</span>;',
    "}",
  ].join("\n");
  assert.deepEqual(byName(text, "packages/apps/src/demo/use-badge.tsx"), {
    useBadge: { lines: 3, effects: 0 },
  });
});

test("measures each exported hook in a file separately", () => {
  const body = Array.from({ length: 250 }, (_, i) => `  const v${i} = ${i};`);
  const text = [
    "export function useBig() {",
    ...body,
    "}",
    "export function useSmall() {",
    "  useEffect(() => {});",
    "}",
  ].join("\n");
  assert.deepEqual(byName(text), {
    useBig: { lines: 252, effects: 0 },
    useSmall: { lines: 3, effects: 1 },
  });
});

test("baseline round-trips and sorts by key", () => {
  const rows = [row("useZed", 300, 1), row("useAlpha", 250, 6, "grandfathered: split tracked")];
  const text = formatBaseline(rows);
  assert.equal(
    text,
    [
      `${hookPath}#useAlpha\t250\t6\tgrandfathered: split tracked`,
      `${hookPath}#useZed\t300\t1\tgrandfathered`,
      "",
    ].join("\n"),
  );
  assert.deepEqual(parseBaseline(text), [rows[1], rows[0]]);
});

test("parseBaseline rejects a malformed row", () => {
  assert.throws(() => parseBaseline(`${hookPath}#useX\tabc\t1\tgrandfathered\n`), /malformed/);
  assert.throws(() => parseBaseline(`${hookPath}\t300\t1\tgrandfathered\n`), /malformed/);
});

test("evaluate passes when every over-limit hook matches its row", () => {
  const counts = measured([
    ["useBig", 300, 1],
    ["useSmall", 50, 2],
  ]);
  assert.deepEqual(evaluate(counts, [row("useBig", 300, 1)], { limits }).errors, []);
});

test("evaluate errors on a new hook over the line limit", () => {
  const { errors } = evaluate(measured([["useNew", 201, 0]]), [], { limits });
  assert.equal(errors.length, 1);
  assert.match(
    errors[0],
    /use-demo\.ts#useNew: 201 lines, 0 effects is over the limits.*not on the baseline/,
  );
});

test("evaluate errors on a new hook over the effect limit", () => {
  const { errors } = evaluate(measured([["useNew", 40, 5]]), [], { limits });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /40 lines, 5 effects is over the limits/);
});

test("evaluate errors when a baselined hook grew in lines", () => {
  const { errors } = evaluate(measured([["useBig", 310, 1]]), [row("useBig", 300, 1)], { limits });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /body lines grew from 300 to 310/);
});

test("evaluate errors when a baselined hook grew in effects", () => {
  const { errors } = evaluate(measured([["useBig", 300, 2]]), [row("useBig", 300, 1)], { limits });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /effect calls grew from 1 to 2/);
});

test("evaluate errors when a baselined hook shrank without update", () => {
  const { errors } = evaluate(measured([["useBig", 290, 5]]), [row("useBig", 300, 6)], { limits });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /body lines shrunk from 300 to 290; run pnpm hook-ratchet:update/);
  assert.match(errors[1], /effect calls shrunk from 6 to 5; run pnpm hook-ratchet:update/);
});

test("evaluate errors when a baselined hook is now within both limits", () => {
  const { errors } = evaluate(measured([["useBig", 200, 4]]), [row("useBig", 200, 4)], { limits });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is within the limits.*run pnpm hook-ratchet:update/);
});

test("evaluate errors when a baselined hook no longer exists", () => {
  const { errors } = evaluate(new Map(), [row("useGone", 300, 1)], { limits });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing or excluded; run pnpm hook-ratchet:update/);
});

test("evaluate errors on unsorted, duplicate, reasonless, and out-of-tree rows", () => {
  const counts = measured([
    ["useA", 300, 0],
    ["useB", 300, 0],
  ]);
  const unsorted = evaluate(counts, [row("useB", 300, 0), row("useA", 300, 0)], { limits });
  assert.ok(unsorted.errors.some((error) => /baseline is not sorted/.test(error)));

  const duplicate = evaluate(
    counts,
    [row("useA", 300, 0), row("useA", 300, 0), row("useB", 300, 0)],
    {
      limits,
    },
  );
  assert.ok(duplicate.errors.some((error) => /duplicate baseline row/.test(error)));

  const reasonless = evaluate(counts, [row("useA", 300, 0, " "), row("useB", 300, 0)], { limits });
  assert.ok(reasonless.errors.some((error) => /baseline reason is empty/.test(error)));

  const outside = evaluate(
    new Map(),
    [{ key: "docs/x.ts#useX", lines: 300, effects: 0, reason: "r" }],
    {
      limits,
    },
  );
  assert.ok(outside.errors.some((error) => /outside packages\/apps\/src/.test(error)));
});

test("nextBaseline lowers both numbers and keeps the reason", () => {
  const { rows, errors } = nextBaseline(
    measured([["useBig", 280, 5]]),
    [row("useBig", 300, 6, "grandfathered: split tracked")],
    { limits },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [row("useBig", 280, 5, "grandfathered: split tracked")]);
});

test("nextBaseline drops rows that are gone or within the limits", () => {
  const { rows, errors } = nextBaseline(
    measured([["useNowSmall", 150, 2]]),
    [row("useGone", 300, 1), row("useNowSmall", 300, 1)],
    { limits },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, []);
});

test("nextBaseline refuses to raise either number", () => {
  const { errors } = nextBaseline(measured([["useBig", 310, 7]]), [row("useBig", 300, 6)], {
    limits,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /refuses to raise body lines 300 to 310 and effect calls 6 to 7/);
});

test("nextBaseline never adds a key", () => {
  const { rows } = nextBaseline(
    measured([
      ["useBig", 300, 1],
      ["useForged", 900, 9],
    ]),
    [row("useBig", 300, 1)],
    { limits },
  );
  assert.deepEqual(
    rows.map((entry) => entry.key),
    [hookKey(hookPath, "useBig")],
  );
});
