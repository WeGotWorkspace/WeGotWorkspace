import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { useDocsHomeCreateDialog } from "@/docs-core/src/use-docs-home-create-dialog";

function listing(listDirectory: DriveAPIOperations["listDirectory"]) {
  return { listDirectory };
}

describe("useDocsHomeCreateDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("starts closed on the personal drive with Untitled.md", () => {
    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument: vi.fn(),
        browsePathPrefix: undefined,
        listingOperations: undefined,
        files: [],
        groupRootSlugs: [],
      }),
    );

    expect(result.current.createDialogOpen).toBe(false);
    expect(result.current.createDialogDefaultName).toBe("Untitled.md");
    expect(result.current.createDialogBrowsePath).toBe("My Drive");
    expect(result.current.createDialogView).toEqual({ type: "folder", path: "My Drive" });
  });

  it("opens a free name in the sidebar drive and confirms the API path", async () => {
    const onCreateDocument = vi.fn();
    const listDirectory = vi.fn(async () => ({
      directory: { files: [{ name: "Untitled.md" }] },
    })) as unknown as DriveAPIOperations["listDirectory"];

    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument,
        browsePathPrefix: "groups/eng",
        listingOperations: listing(listDirectory),
        files: [],
        groupRootSlugs: ["eng"],
      }),
    );

    act(() => {
      result.current.handleCreateDocument();
    });

    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    expect(result.current.createDialogBrowsePath).toBe("Groups/eng");
    expect(result.current.createDialogView).toEqual({ type: "folder", path: "Groups/eng" });
    expect(result.current.createDialogDefaultName).toBe("Untitled 2.md");
    expect(listDirectory).toHaveBeenCalledWith("/groups/eng");

    act(() => {
      result.current.confirmCreateDocument("  Notes.md  ", "Groups/eng");
    });
    expect(onCreateDocument).toHaveBeenCalledWith("/groups/eng/Notes.md");
    expect(result.current.createDialogOpen).toBe(false);
  });

  it("uses a timestamped name when the directory listing fails", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as DriveAPIOperations["listDirectory"];

    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument: vi.fn(),
        browsePathPrefix: undefined,
        listingOperations: listing(listDirectory),
        files: [],
        groupRootSlugs: [],
      }),
    );

    act(() => {
      result.current.handleCreateDocument();
    });

    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    expect(result.current.createDialogDefaultName).toMatch(
      /^Untitled \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.md$/,
    );
  });

  it("does not confirm a blank name or open without a user or create handler", async () => {
    const onCreateDocument = vi.fn();
    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument,
        browsePathPrefix: undefined,
        listingOperations: undefined,
        files: [] as DriveFile[],
        groupRootSlugs: [],
      }),
    );

    act(() => {
      result.current.handleCreateDocument();
    });
    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    act(() => {
      result.current.confirmCreateDocument("   ", "My Drive");
    });
    expect(onCreateDocument).not.toHaveBeenCalled();
    expect(result.current.createDialogOpen).toBe(true);

    act(() => {
      result.current.closeCreateDialog();
    });
    expect(result.current.createDialogOpen).toBe(false);

    const blocked = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "  ",
        onCreateDocument,
        browsePathPrefix: undefined,
        listingOperations: undefined,
        files: [],
        groupRootSlugs: [],
      }),
    );
    act(() => {
      blocked.result.current.handleCreateDocument();
    });
    expect(blocked.result.current.createDialogOpen).toBe(false);

    const missing = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        browsePathPrefix: undefined,
        listingOperations: undefined,
        files: [],
        groupRootSlugs: [],
      }),
    );
    act(() => {
      missing.result.current.handleCreateDocument();
    });
    expect(missing.result.current.createDialogOpen).toBe(false);
  });

  it("names an imported Word file after it and hands the file over on confirm", async () => {
    const onCreateDocument = vi.fn();
    const onImportWordFile = vi.fn();
    const listDirectory = vi.fn(async () => ({
      directory: { files: [{ name: "Board letter.md" }] },
    })) as unknown as DriveAPIOperations["listDirectory"];
    const file = new File(["x"], "Board letter.docx");

    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument,
        onImportWordFile,
        browsePathPrefix: undefined,
        listingOperations: listing(listDirectory),
        files: [],
        groupRootSlugs: [],
      }),
    );

    act(() => {
      result.current.handleImportWordFile(file);
    });
    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    expect(result.current.createDialogDefaultName).toBe("Board letter 2.md");
    expect(result.current.createDialogImportSourceName).toBe("Board letter.docx");

    act(() => {
      result.current.confirmCreateDocument("Board letter 2.md", "My Drive");
    });
    expect(onImportWordFile).toHaveBeenCalledWith(file, "/users/alice/Board letter 2.md");
    expect(onCreateDocument).not.toHaveBeenCalled();
    expect(result.current.createDialogImportSourceName).toBeNull();
  });

  it("forgets the Word file when the import dialog is closed", async () => {
    const onCreateDocument = vi.fn();
    const onImportWordFile = vi.fn();
    const { result } = renderHook(() =>
      useDocsHomeCreateDialog({
        username: "alice",
        onCreateDocument,
        onImportWordFile,
        browsePathPrefix: undefined,
        listingOperations: undefined,
        files: [],
        groupRootSlugs: [],
      }),
    );

    act(() => {
      result.current.handleImportWordFile(new File(["x"], "Plan.docx"));
    });
    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    act(() => {
      result.current.closeCreateDialog();
    });
    act(() => {
      result.current.handleCreateDocument();
    });
    await waitFor(() => {
      expect(result.current.createDialogOpen).toBe(true);
    });
    expect(result.current.createDialogDefaultName).toBe("Untitled.md");
    act(() => {
      result.current.confirmCreateDocument("Untitled.md", "My Drive");
    });
    expect(onCreateDocument).toHaveBeenCalledWith("/users/alice/Untitled.md");
    expect(onImportWordFile).not.toHaveBeenCalled();
  });
});
