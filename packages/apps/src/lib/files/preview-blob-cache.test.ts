import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPreviewBlobCache,
  PREVIEW_BLOB_CACHE_MAX_BYTES,
  PREVIEW_BLOB_CACHE_MAX_ENTRY_BYTES,
  previewBlobCacheKey,
  readPreviewBlob,
  writePreviewBlob,
} from "@/lib/files/preview-blob-cache";

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe("preview blob cache", () => {
  beforeEach(() => clearPreviewBlobCache());

  it("keys by account, path and modified time", () => {
    expect(previewBlobCacheKey("alice", "/groups/t/x.png", 5)).toBe("alice:groups/t/x.png@5");
    expect(previewBlobCacheKey("bob", "groups/t/x.png")).toBe("bob:groups/t/x.png@");
  });

  it("returns what was written", () => {
    const blob = blobOf(10);
    writePreviewBlob("k", blob);
    expect(readPreviewBlob("k")).toBe(blob);
  });

  it("skips a blob above the per-entry limit", () => {
    writePreviewBlob("big", blobOf(PREVIEW_BLOB_CACHE_MAX_ENTRY_BYTES + 1));
    expect(readPreviewBlob("big")).toBeNull();
  });

  it("drops the least recently used entries above the byte budget", () => {
    const size = PREVIEW_BLOB_CACHE_MAX_ENTRY_BYTES;
    const count = PREVIEW_BLOB_CACHE_MAX_BYTES / size;
    for (let i = 0; i < count; i += 1) writePreviewBlob(`k${i}`, blobOf(size));
    // Touch k0 so k1 is the oldest.
    expect(readPreviewBlob("k0")).not.toBeNull();
    writePreviewBlob("new", blobOf(size));
    expect(readPreviewBlob("k1")).toBeNull();
    expect(readPreviewBlob("k0")).not.toBeNull();
    expect(readPreviewBlob("new")).not.toBeNull();
  });
});
