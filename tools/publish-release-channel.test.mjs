import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  channelTag,
  compareVersions,
  staleZipAssets,
} from "./publish-release-channel.mjs";

describe("compareVersions", () => {
  const ascending = [
    "0.1.121",
    "0.1.122-beta.1",
    "0.1.122-beta.2",
    "0.1.122-beta.10",
    "0.1.122-edge.5",
    "0.1.122-edge.40",
    "0.1.122",
    "v0.2.0",
    "1.0.0",
  ];

  it("orders versions by semver precedence", () => {
    for (let i = 1; i < ascending.length; i++) {
      assert.ok(
        compareVersions(ascending[i - 1], ascending[i]) < 0,
        `${ascending[i - 1]} < ${ascending[i]}`,
      );
      assert.ok(
        compareVersions(ascending[i], ascending[i - 1]) > 0,
        `${ascending[i]} > ${ascending[i - 1]}`,
      );
    }
  });

  it("treats a leading v and build metadata as equal", () => {
    assert.equal(compareVersions("v1.2.3", "1.2.3+abc"), 0);
  });

  it("rejects a non-semver version", () => {
    assert.throws(
      () => compareVersions("1.2", "1.2.0"),
      /not a semver version/,
    );
  });
});

describe("channelTag", () => {
  it("maps beta and edge to rolling release tags", () => {
    assert.equal(channelTag("beta"), "channel-beta");
    assert.equal(channelTag("edge"), "channel-edge");
  });

  it("refuses stable, which is GitHub's releases/latest", () => {
    assert.throws(() => channelTag("stable"), /unknown channel/);
  });
});

describe("staleZipAssets", () => {
  it("lists only older deploy ZIPs", () => {
    const names = [
      "manifest.json",
      "wegotworkspace-deploy-0.1.122-edge.4.zip",
      "wegotworkspace-deploy-0.1.122-edge.5.zip",
      "docker-compose.yml",
    ];
    assert.deepEqual(
      staleZipAssets(names, "wegotworkspace-deploy-0.1.122-edge.5.zip"),
      ["wegotworkspace-deploy-0.1.122-edge.4.zip"],
    );
  });
});
