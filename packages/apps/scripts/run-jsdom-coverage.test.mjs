import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
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
    const dir = mkdtempSync(path.join(tmpdir(), "run-jsdom-link-"));
    const link = path.join(dir, "run-jsdom.mjs");
    try {
      symlinkSync(script, link);
      expect(isDirectInvocation(new URL("./run-jsdom.mjs", import.meta.url).href, link)).toBe(true);
      expect(isDirectInvocation(new URL("./run-jsdom.mjs", import.meta.url).href, undefined)).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
