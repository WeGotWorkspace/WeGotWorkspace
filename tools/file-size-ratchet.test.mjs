import assert from "node:assert/strict";
import test from "node:test";

import { countLines, FILE_SIZE_RULE } from "./file-size-ratchet.mjs";

test("counts a last line that has no trailing newline", () => {
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines(""), 0);
  assert.equal(countLines("\n"), 1);
});

test("rule sentence names both the new-file and the shrink cases", () => {
  assert.match(FILE_SIZE_RULE, /over 400 lines/);
  assert.match(FILE_SIZE_RULE, /stored integer was not lowered/);
});
