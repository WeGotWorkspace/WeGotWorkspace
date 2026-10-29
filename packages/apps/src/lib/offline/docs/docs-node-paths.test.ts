/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { readOfflineDocsUsername } from "@/lib/offline/offline-session";
import {
  readDocsNodeIdForPath,
  readDocsPathForNodeId,
  recordDocsNodePath,
} from "@/lib/offline/docs/docs-node-paths";

const A = `fn-${"a".repeat(32)}`;
const B = `fn-${"b".repeat(32)}`;

describe("docs node paths", () => {
  it("reads back what was recorded, both ways", async () => {
    await recordDocsNodePath("np-both", A, "/users/ada/plan.md");
    expect(await readDocsPathForNodeId("np-both", A)).toBe("/users/ada/plan.md");
    expect(await readDocsNodeIdForPath("np-both", "users/ada/plan.md")).toBe(A);
    expect(await readDocsNodeIdForPath("np-both", "/users/ada/plan.md")).toBe(A);
  });

  it("remembers the account so the editor can find the record", async () => {
    await recordDocsNodePath("np-account", A, "/users/ada/plan.md");
    expect(readOfflineDocsUsername()).toBe("np-account");
  });

  it("moves the id to its new path", async () => {
    await recordDocsNodePath("np-move", A, "/users/ada/plan.md");
    await recordDocsNodePath("np-move", A, "/users/ada/Projects/roadmap.md");
    expect(await readDocsPathForNodeId("np-move", A)).toBe("/users/ada/Projects/roadmap.md");
    expect(await readDocsNodeIdForPath("np-move", "/users/ada/plan.md")).toBeUndefined();
  });

  it("gives a path to the file that took it last", async () => {
    await recordDocsNodePath("np-took", A, "/users/ada/plan.md");
    await recordDocsNodePath("np-took", B, "/users/ada/plan.md");
    expect(await readDocsNodeIdForPath("np-took", "/users/ada/plan.md")).toBe(B);
    expect(await readDocsPathForNodeId("np-took", A)).toBeUndefined();
  });

  it("is empty for an unknown id, path, or account", async () => {
    expect(await readDocsPathForNodeId("np-none", A)).toBeUndefined();
    expect(await readDocsNodeIdForPath("np-none", "/users/ada/plan.md")).toBeUndefined();
    expect(await readDocsPathForNodeId("np-none", " ")).toBeUndefined();
  });
});
