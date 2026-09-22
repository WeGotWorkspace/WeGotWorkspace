import { describe, expect, it } from "vitest";

import { isCiEnv, jsdomConcurrency } from "./jsdom-concurrency.mjs";

const GB = 1024 ** 3;

describe("jsdomConcurrency", () => {
  it("stays serial outside CI", () => {
    expect(jsdomConcurrency({ ci: false, cpus: 10, totalMemBytes: 16 * GB })).toEqual({
      packed: 1,
      solo: 1,
    });
  });

  it("weights a GitHub-hosted runner to 3 packed shards and 2 solo processes", () => {
    expect(jsdomConcurrency({ ci: true, cpus: 4, totalMemBytes: 16 * GB })).toEqual({
      packed: 3,
      solo: 2,
    });
  });

  it("drops to one process when CPU or memory is tight", () => {
    expect(jsdomConcurrency({ ci: true, cpus: 2, totalMemBytes: 7 * GB })).toEqual({
      packed: 1,
      solo: 1,
    });
  });

  it("caps packed shards at 4 even on a large CI host", () => {
    expect(jsdomConcurrency({ ci: true, cpus: 16, totalMemBytes: 64 * GB })).toEqual({
      packed: 4,
      solo: 2,
    });
  });

  it("honors explicit overrides in CI and locally", () => {
    expect(
      jsdomConcurrency({
        ci: false,
        cpus: 4,
        totalMemBytes: 16 * GB,
        packedOverride: "2",
        soloOverride: "1",
      }),
    ).toEqual({ packed: 2, solo: 1 });
  });

  it("rejects a non-positive override", () => {
    expect(() =>
      jsdomConcurrency({
        ci: true,
        cpus: 4,
        totalMemBytes: 16 * GB,
        packedOverride: "0",
      }),
    ).toThrow(/JSDOM_CONCURRENCY/);
  });
});

describe("isCiEnv", () => {
  it("accepts the values GitHub and other runners set", () => {
    expect(isCiEnv("true")).toBe(true);
    expect(isCiEnv("1")).toBe(true);
    expect(isCiEnv(undefined)).toBe(false);
    expect(isCiEnv("false")).toBe(false);
  });
});
