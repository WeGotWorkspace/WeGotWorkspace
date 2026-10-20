import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectChildDigests,
  isEdgeBuildTag,
  isPrunableEdgeVersion,
  planEdgePrune,
} from "./ghcr-prune-edge-images.mjs";

const cutoff = new Date("2026-10-06T00:00:00Z");
const OLD = "2026-09-01T00:00:00Z";
const NEW = "2026-10-19T00:00:00Z";

let nextId = 1;
function version(name, tags, created_at = OLD) {
  return { id: nextId++, name, created_at, tags };
}

describe("isEdgeBuildTag", () => {
  it("accepts per-build edge tags", () => {
    assert.ok(isEdgeBuildTag("0.1.122-edge.57"));
    assert.ok(isEdgeBuildTag("10.20.30-edge.1"));
  });

  it("rejects every other tag", () => {
    for (const tag of [
      "edge",
      "latest",
      "0.1.122",
      "v0.1.122-edge.57",
      "0.1.122-beta.1",
      "0.1.122-edge",
      "0.1.122-edge.57.1",
      "0.1.122-edge.x",
      "sha-abc123",
      "",
    ]) {
      assert.equal(isEdgeBuildTag(tag), false, tag);
    }
  });
});

describe("isPrunableEdgeVersion", () => {
  it("prunes an old version whose only tag is an edge build tag", () => {
    assert.ok(isPrunableEdgeVersion(version("d", ["0.1.1-edge.3"]), cutoff));
  });

  it("keeps an edge build inside the grace window", () => {
    assert.equal(
      isPrunableEdgeVersion(version("d", ["0.1.1-edge.3"], NEW), cutoff),
      false,
    );
  });

  it("keeps a version that also carries edge, latest or a release tag", () => {
    for (const extra of ["edge", "latest", "0.1.1", "0.1.2-beta.1"]) {
      assert.equal(
        isPrunableEdgeVersion(version("d", ["0.1.1-edge.3", extra]), cutoff),
        false,
        extra,
      );
    }
  });

  it("never prunes an untagged version on its own", () => {
    assert.equal(isPrunableEdgeVersion(version("d", []), cutoff), false);
  });
});

describe("planEdgePrune", () => {
  function ids(plan) {
    return plan.map(({ index, children }) => [
      index.name,
      children.map((c) => c.name),
    ]);
  }

  it("deletes an old edge index together with its untagged children", () => {
    const versions = [
      version("idx-old", ["0.1.1-edge.3"]),
      version("amd64-old", []),
      version("arm64-old", []),
      version("idx-live", ["0.1.1-edge.9", "edge"], NEW),
      version("amd64-live", [], NEW),
    ];
    const childrenOf = new Map([
      ["idx-old", ["amd64-old", "arm64-old"]],
      ["idx-live", ["amd64-live"]],
    ]);
    assert.deepEqual(ids(planEdgePrune(versions, childrenOf, cutoff)), [
      ["idx-old", ["amd64-old", "arm64-old"]],
    ]);
  });

  it("keeps a child that a kept index also references", () => {
    const versions = [
      version("idx-old", ["0.1.1-edge.3"]),
      version("shared", []),
      version("own", []),
      version("idx-release", ["0.1.1", "latest"]),
    ];
    const childrenOf = new Map([
      ["idx-old", ["shared", "own"]],
      ["idx-release", ["shared"]],
    ]);
    assert.deepEqual(ids(planEdgePrune(versions, childrenOf, cutoff)), [
      ["idx-old", ["own"]],
    ]);
  });

  it("keeps an untagged child newer than the cutoff", () => {
    const versions = [
      version("idx-old", ["0.1.1-edge.3"]),
      version("fresh", [], NEW),
    ];
    const childrenOf = new Map([["idx-old", ["fresh"]]]);
    assert.deepEqual(ids(planEdgePrune(versions, childrenOf, cutoff)), [
      ["idx-old", []],
    ]);
  });

  it("lists a child shared by two deleted indexes once", () => {
    const versions = [
      version("idx-a", ["0.1.1-edge.3"]),
      version("idx-b", ["0.1.1-edge.4"]),
      version("shared", []),
    ];
    const childrenOf = new Map([
      ["idx-a", ["shared"]],
      ["idx-b", ["shared"]],
    ]);
    assert.deepEqual(ids(planEdgePrune(versions, childrenOf, cutoff)), [
      ["idx-a", ["shared"]],
      ["idx-b", []],
    ]);
  });

  it("leaves unreferenced untagged versions alone", () => {
    const versions = [version("orphan", []), version("idx", ["0.1.1"])];
    const childrenOf = new Map([["idx", []]]);
    assert.deepEqual(planEdgePrune(versions, childrenOf, cutoff), []);
  });

  it("skips a child that is already gone", () => {
    const versions = [version("idx-old", ["0.1.1-edge.3"])];
    const childrenOf = new Map([["idx-old", ["missing"]]]);
    assert.deepEqual(ids(planEdgePrune(versions, childrenOf, cutoff)), [
      ["idx-old", []],
    ]);
  });
});

describe("collectChildDigests", () => {
  const INDEX = "application/vnd.oci.image.index.v1+json";
  const MANIFEST = "application/vnd.oci.image.manifest.v1+json";

  it("walks nested indexes and lists each digest once", async () => {
    const manifests = {
      top: {
        manifests: [
          { digest: "amd64", mediaType: MANIFEST },
          { digest: "nested", mediaType: INDEX },
        ],
      },
      nested: {
        manifests: [
          { digest: "arm64", mediaType: MANIFEST },
          { digest: "amd64", mediaType: MANIFEST },
        ],
      },
    };
    const fetched = [];
    const children = await collectChildDigests("top", async (digest) => {
      fetched.push(digest);
      return manifests[digest];
    });
    assert.deepEqual(children, ["amd64", "nested", "arm64"]);
    assert.deepEqual(fetched, ["top", "nested"]);
  });

  it("returns no children for a single-platform manifest", async () => {
    const children = await collectChildDigests("img", async () => ({
      layers: [],
    }));
    assert.deepEqual(children, []);
  });
});
