import { symlinkSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { coverageVitestArgs, isDirectInvocation } from "./run-jsdom.mjs";

describe("coverageVitestArgs", () => {
  it("passes blob reporter flags and a unique reports directory per shard", () => {
    const first = coverageVitestArgs("jsdom-1");
    const second = coverageVitestArgs("jsdom-2");

    expect(first).toEqual([
      "--coverage",
      "--reporter=blob",
      "--outputFile=.vitest-reports/blob-jsdom-1.json",
      "--coverage.reportsDirectory=.coverage-shards/jsdom-1",
    ]);
    expect(second).toContain("--coverage.reportsDirectory=.coverage-shards/jsdom-2");
    expect(second).not.toEqual(first);
  });

  it("treats a symlinked argv path as a direct invocation", () => {
    const script = fileURLToPath(new URL("./run-jsdom.mjs", import.meta.url));
    const link = path.join(path.dirname(script), ".run-jsdom-link.mjs");
    symlinkSync(script, link);
    try {
      expect(isDirectInvocation(new URL("./run-jsdom.mjs", import.meta.url).href, link)).toBe(true);
      expect(isDirectInvocation(new URL("./run-jsdom.mjs", import.meta.url).href, undefined)).toBe(
        false,
      );
    } finally {
      unlinkSync(link);
    }
  });
});
