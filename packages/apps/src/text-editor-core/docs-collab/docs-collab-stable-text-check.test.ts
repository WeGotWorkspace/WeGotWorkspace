import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const loadCollabText = vi.fn();
const fetchYjsSnapshot = vi.fn();
const checkSnapshotText = vi.fn();

vi.mock("@/lib/collab/docs-collab-server-io", () => ({
  loadCollabText: (...args: unknown[]) => loadCollabText(...args),
  fetchYjsSnapshot: (...args: unknown[]) => fetchYjsSnapshot(...args),
}));
vi.mock("./docs-collab-snapshot-check", () => ({
  checkSnapshotText: (...args: unknown[]) => checkSnapshotText(...args),
}));

import { loadStableTextCheck } from "./docs-collab-stable-text-check";

const urls = { documentUrl: "/doc", yjsUrl: "/doc?format=yjs" };
const update = Y.encodeStateAsUpdate(new Y.Doc());
const text = { markdown: "Real", title: "Plan", titled: true, etag: '"t"' };

describe("loadStableTextCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCollabText.mockResolvedValue(text);
  });

  it("confirms a mismatch only when the state tag held across the text read", async () => {
    checkSnapshotText.mockReturnValue("mismatch");
    fetchYjsSnapshot.mockResolvedValue({ update, etag: '"s1"' });
    expect(
      await loadStableTextCheck({ update, etag: '"s1"' }, urls, undefined, "markdown"),
    ).toEqual({ mismatch: true, text });
  });

  it("treats a moved state tag as a peer save, not an outside write", async () => {
    checkSnapshotText.mockReturnValue("mismatch");
    fetchYjsSnapshot.mockResolvedValue({ update, etag: '"s2"' });
    expect(
      await loadStableTextCheck({ update, etag: '"s1"' }, urls, undefined, "markdown"),
    ).toBeNull();
  });

  it("reports a match without a second snapshot read", async () => {
    checkSnapshotText.mockReturnValue("match");
    expect(
      await loadStableTextCheck({ update, etag: '"s1"' }, urls, undefined, "markdown"),
    ).toEqual({ mismatch: false, text });
    expect(fetchYjsSnapshot).not.toHaveBeenCalled();
  });

  it("adopts (null) when the text cannot be loaded", async () => {
    loadCollabText.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      await loadStableTextCheck({ update, etag: '"s1"' }, urls, undefined, "markdown"),
    ).toBeNull();
  });

  it("adopts (null) when the state has no tag to compare", async () => {
    expect(
      await loadStableTextCheck({ update, etag: null }, urls, undefined, "markdown"),
    ).toBeNull();
    expect(loadCollabText).not.toHaveBeenCalled();
  });
});
