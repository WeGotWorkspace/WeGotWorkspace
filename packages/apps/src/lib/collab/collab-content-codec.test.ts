/** @vitest-environment jsdom */
import { afterAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type CollabContentCodec,
  loadCollabContentCodec,
  provideCollabContentCodec,
} from "./collab-content-codec";

const fakeCodec: CollabContentCodec = {
  readContentFromYDoc: () => "text",
  applyContentSeedToYDoc: () => {},
};

describe("collab content codec", () => {
  afterAll(() => {
    // Put the real editor codec back for the other tests in this worker.
    provideCollabContentCodec(
      () => import("@/text-editor-core/docs-collab/docs-collab-editor-surface"),
    );
  });

  it("loads once and reuses the codec", async () => {
    const load = vi.fn(async () => fakeCodec);
    provideCollabContentCodec(load);
    expect(await loadCollabContentCodec()).toBe(fakeCodec);
    expect(await loadCollabContentCodec()).toBe(fakeCodec);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load", async () => {
    const load = vi
      .fn<() => Promise<CollabContentCodec>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce(fakeCodec);
    provideCollabContentCodec(load);
    await expect(loadCollabContentCodec()).rejects.toThrow("chunk failed");
    expect(await loadCollabContentCodec()).toBe(fakeCodec);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("the setup file provides the editor codec, which round-trips Markdown", async () => {
    provideCollabContentCodec(
      () => import("@/text-editor-core/docs-collab/docs-collab-editor-surface"),
    );
    const codec = await loadCollabContentCodec();
    const doc = new Y.Doc();
    codec.applyContentSeedToYDoc(doc, "# Title\n\nBody text", "markdown");
    expect(codec.readContentFromYDoc(doc, "markdown")).toContain("Body text");
    doc.destroy();
  });
});
