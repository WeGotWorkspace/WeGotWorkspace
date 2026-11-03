import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeVersion } from "./edge-version.mjs";
import { compareVersions } from "./publish-release-channel.mjs";

describe("edgeVersion", () => {
  it("builds the next patch after a release", () => {
    assert.equal(edgeVersion("0.1.121", 57), "0.1.122-edge.57");
    assert.equal(edgeVersion("0.1.121\n", "57"), "0.1.122-edge.57");
  });

  it("keeps X.Y.Z while VERSION is a prerelease of it", () => {
    assert.equal(edgeVersion("1.3.0-beta.1", 8), "1.3.0-edge.8");
    assert.equal(edgeVersion("1.3.0-rc.2", 9), "1.3.0-edge.9");
  });

  it("sorts every edge build below the release that follows it", () => {
    // VERSION -> the stable release `release:publish patch` makes next.
    for (const [version, nextStable] of [
      ["0.1.121", "0.1.122"],
      ["1.3.0-beta.1", "1.3.0"],
      ["1.3.0-rc.2", "1.3.0"],
    ]) {
      const edge = edgeVersion(version, 999);
      assert.ok(
        compareVersions(edge, nextStable) < 0,
        `${edge} < ${nextStable}`,
      );
    }
  });

  it("rejects a non-semver VERSION or run number", () => {
    assert.throws(() => edgeVersion("1.3", 1), /not semver/);
    assert.throws(() => edgeVersion("1.3.0", "x"), /positive integer/);
    assert.throws(() => edgeVersion("1.3.0", 0), /positive integer/);
  });
});
