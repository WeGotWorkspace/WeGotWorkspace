import { expect, test } from "vitest";
import { parse } from "../src/ycsv-core/parse";
import { serialize } from "../src/ycsv-core/serialize";
import { SEED } from "../src/stories/fixtures";

function lineDiff(before: string, after: string): { changed: number } {
  const left = before.split("\n");
  const right = after.split("\n");
  const count = Math.max(left.length, right.length);
  let changed = 0;
  for (let i = 0; i < count; i += 1) {
    if (left[i] !== right[i]) changed += 1;
  }
  return { changed };
}

test("serialization is idempotent and SEED is canonical", () => {
  const once = serialize(parse(SEED));
  const twice = serialize(parse(once));
  expect(twice).toBe(once);
  expect(once).toBe(SEED);
});

test("one cell edit is a one-line diff", () => {
  const file = parse(SEED);
  const row = file.rows[1];
  if (!row) throw new Error("missing row");
  row[1] = "7";
  const diff = lineDiff(SEED, serialize(file));
  expect(diff.changed).toBe(1);
});
