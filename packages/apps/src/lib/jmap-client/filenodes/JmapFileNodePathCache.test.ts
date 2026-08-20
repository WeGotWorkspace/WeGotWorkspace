import { describe, expect, it } from "vitest";
import { JmapFileNodePathCache } from "./JmapFileNodePathCache.js";
import type { JmapFileNode } from "./types.js";

function node(id: string, name: string, parentId: string | null = null): JmapFileNode {
  return {
    id,
    parentId,
    nodeType: "directory",
    blobId: null,
    name,
    size: null,
    type: null,
  };
}

describe("JmapFileNodePathCache", () => {
  it("maps the personal home and other top-level nodes onto users/groups paths", () => {
    const cache = new JmapFileNodePathCache();
    cache.rememberTopLevel("bob", [node("fn-home", "bob"), node("fn-eng", "engineering")]);

    expect(cache.nodeIdForPath("/users/bob")).toBe("fn-home");
    expect(cache.nodeIdForPath("/groups/engineering")).toBe("fn-eng");
    expect(cache.pathForNodeId("fn-home")).toBe("/users/bob");
  });

  it("remembers children under a parent path and forgets a moved subtree", () => {
    const cache = new JmapFileNodePathCache();
    cache.remember("/users/bob", node("fn-home", "bob"));
    cache.rememberChildren("/users/bob", [node("fn-docs", "Docs", "fn-home")]);
    cache.rememberChildren("/users/bob/Docs", [node("fn-file", "readme.md", "fn-docs")]);

    expect(cache.nodeIdForPath("/users/bob/Docs/readme.md")).toBe("fn-file");
    cache.movePath("/users/bob/Docs", "/users/bob/Archive");
    expect(cache.nodeIdForPath("/users/bob/Archive/readme.md")).toBe("fn-file");
    expect(cache.nodeIdForPath("/users/bob/Docs/readme.md")).toBeUndefined();
  });
});
