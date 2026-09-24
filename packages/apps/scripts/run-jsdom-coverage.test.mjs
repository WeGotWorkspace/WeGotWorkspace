import { describe, expect, it } from "vitest";

import { coverageVitestArgs } from "./run-jsdom.mjs";

describe("coverageVitestArgs", () => {
  it("passes blob reporter flags and a unique reports directory per shard", () => {
    const first = coverageVitestArgs("jsdom-1");
    const second = coverageVitestArgs("jsdom-2");

    expect(first).toEqual([
      "--coverage",
      "--reporter=blob",
      "--outputFile=.vitest-reports/blob-jsdom-1.json",
      "--coverage.reportsDirectory=coverage/shard-jsdom-1",
    ]);
    expect(second).toContain("--coverage.reportsDirectory=coverage/shard-jsdom-2");
    expect(second).not.toEqual(first);
  });
});
