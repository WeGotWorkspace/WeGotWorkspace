/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveFile } from "@/drive-core/src/drive-models";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import * as filePreviewUtils from "@/lib/file-preview/file-preview-utils";
import { useDriveGridPreviews } from "@/drive-core/src/use-drive-grid-previews";

const DOC: DriveFile = {
  id: "doc-1",
  category: "document",
  date: "Now",
  title: "Notes.md",
  excerpt: "",
  body: [],
  notebook: "",
  tags: [],
  wordCount: 0,
  parent: "My Drive",
  kind: "doc",
  size: "1 KB",
  apiPath: "/users/alice/Notes.md",
};

const IMAGE: DriveFile = {
  ...DOC,
  id: "img-1",
  title: "photo.png",
  kind: "image",
  apiPath: "/users/alice/photo.png",
};

function createOperations(
  handlers: Partial<Pick<DriveAPIOperations, "readFileBlob">>,
): DriveAPIOperations {
  return {
    refreshState: async () => ({}) as never,
    changeDir: async () => ({}) as never,
    listDirectory: async () => ({}) as never,
    search: async () => [],
    createFolder: async () => ({}) as never,
    createFile: async () => ({}) as never,
    renameItem: async () => ({}) as never,
    deleteItems: async () => ({}) as never,
    downloadFile: async () => {},
    readFileBlob: handlers.readFileBlob ?? (async () => new Blob()),
    checkUploadReady: async () => {},
    listStars: async () => [],
    listEntriesByPaths: async () => [],
    setStar: async () => {},
    uploadFiles: async () => ({}) as never,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDriveGridPreviews", () => {
  it("does not prefetch text or docs body previews for grid-only markdown tiles", async () => {
    const readFileBlob = vi.fn(async () => new Blob(["# Full doc"], { type: "text/markdown" }));
    const file = { ...DOC, excerpt: "Indexed preview snippet for the tile." };

    const { result } = renderHook(() =>
      useDriveGridPreviews({
        items: [file],
        operations: createOperations({ readFileBlob }),
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(readFileBlob).not.toHaveBeenCalled();
    expect(result.current.filePreviews[file.id]).toBeUndefined();
    expect(result.current.richPreviews[file.id]).toBeUndefined();
  });

  it("fetches blob URLs for image tiles and revokes on unmount", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const readFileBlob = vi.fn(async () => blob);
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const readDimensions = vi
      .spyOn(filePreviewUtils, "readBlobMediaDimensions")
      .mockResolvedValue({ width: 120, height: 80 });

    const { result, unmount } = renderHook(() =>
      useDriveGridPreviews({
        items: [IMAGE],
        operations: createOperations({ readFileBlob }),
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.filePreviews[IMAGE.id]?.kind).toBe("blob-url");
    });
    expect(readFileBlob).toHaveBeenCalledWith(IMAGE.apiPath);
    expect(readDimensions).toHaveBeenCalledWith(blob, "image");
    expect(result.current.filePreviews[IMAGE.id]).toMatchObject({
      kind: "blob-url",
      width: 120,
      height: 80,
    });

    unmount();
    expect(revokeSpy).toHaveBeenCalled();
  });

  it("drops media previews for items that scroll out of the visible set", async () => {
    const readFileBlob = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    vi.spyOn(filePreviewUtils, "readBlobMediaDimensions").mockResolvedValue({
      width: 120,
      height: 80,
    });

    const { result, rerender } = renderHook(
      ({ items }: { items: DriveFile[] }) =>
        useDriveGridPreviews({
          items,
          operations: createOperations({ readFileBlob }),
          enabled: true,
        }),
      { initialProps: { items: [IMAGE] } },
    );

    await waitFor(() => {
      expect(result.current.filePreviews[IMAGE.id]).toBeDefined();
    });

    await act(async () => {
      rerender({ items: [] });
    });

    expect(result.current.filePreviews[IMAGE.id]).toBeUndefined();
  });

  it("fetches full docs preview for the active detail file", async () => {
    const markdown = "# Hello\n\nPreview body for the detail pane.";
    const readFileBlob = vi.fn(async () => new Blob([markdown], { type: "text/markdown" }));

    const { result } = renderHook(() =>
      useDriveGridPreviews({
        items: [DOC],
        operations: createOperations({ readFileBlob }),
        enabled: true,
        extraFile: DOC,
      }),
    );

    await waitFor(() => {
      expect(result.current.richPreviews[DOC.id]?.kind).toBe("docs");
    });
    expect(readFileBlob).toHaveBeenCalledWith(DOC.apiPath);
    expect(result.current.richPreviews[DOC.id]).toMatchObject({
      kind: "docs",
      content: markdown,
    });
    expect(result.current.filePreviews[DOC.id]?.kind).toBe("text");
  });

  it("uses search excerpt for detail text fallback and still fetches rich docs preview", async () => {
    const readFileBlob = vi.fn(async () => new Blob(["# Full doc"], { type: "text/markdown" }));
    const file = { ...DOC, excerpt: "Indexed preview snippet for the tile." };

    const { result } = renderHook(() =>
      useDriveGridPreviews({
        items: [file],
        operations: createOperations({ readFileBlob }),
        enabled: true,
        extraFile: file,
      }),
    );

    await waitFor(() => {
      expect(result.current.filePreviews[file.id]?.kind).toBe("text");
    });
    await waitFor(() => {
      expect(result.current.richPreviews[file.id]?.kind).toBe("docs");
    });
    expect(readFileBlob).toHaveBeenCalledWith(file.apiPath);
    expect(result.current.filePreviews[file.id]).toMatchObject({
      kind: "text",
      content: expect.stringContaining("Indexed preview"),
    });
  });

  it("fetches docs preview for empty markdown when extraFile is set without grid prefetch", async () => {
    const readFileBlob = vi.fn(async () => new Blob([], { type: "text/markdown" }));

    const { result } = renderHook(() =>
      useDriveGridPreviews({
        items: [DOC],
        operations: createOperations({ readFileBlob }),
        enabled: false,
        extraFile: DOC,
      }),
    );

    await waitFor(() => {
      expect(result.current.richPreviews[DOC.id]?.kind).toBe("docs");
    });
    expect(readFileBlob).toHaveBeenCalledWith(DOC.apiPath);
    expect(result.current.richPreviews[DOC.id]).toMatchObject({
      kind: "docs",
      content: "",
    });
  });

  it("drops rich previews when the detail file is cleared", async () => {
    const readFileBlob = vi.fn(async () => new Blob(["# Hello"], { type: "text/markdown" }));

    const { result, rerender } = renderHook(
      ({ extraFile }: { extraFile: DriveFile | null }) =>
        useDriveGridPreviews({
          items: [DOC],
          operations: createOperations({ readFileBlob }),
          enabled: true,
          extraFile,
        }),
      { initialProps: { extraFile: DOC as DriveFile | null } },
    );

    await waitFor(() => {
      expect(result.current.richPreviews[DOC.id]?.kind).toBe("docs");
    });

    await act(async () => {
      rerender({ extraFile: null });
    });

    expect(result.current.richPreviews[DOC.id]).toBeUndefined();
  });

  it("keeps text fallback when docs fetch exceeds size limit", async () => {
    const oversized = "word ".repeat(Math.ceil(filePreviewUtils.DOCS_PREVIEW_MAX_BYTES / 5));
    const readFileBlob = vi.fn(async () => new Blob([oversized], { type: "text/markdown" }));

    const { result } = renderHook(() =>
      useDriveGridPreviews({
        items: [DOC],
        operations: createOperations({ readFileBlob }),
        enabled: true,
        extraFile: DOC,
      }),
    );

    await waitFor(() => {
      expect(readFileBlob).toHaveBeenCalled();
    });
    expect(result.current.richPreviews[DOC.id]).toBeUndefined();
    await waitFor(() => {
      expect(result.current.filePreviews[DOC.id]?.kind).toBe("text");
    });
  });
});
