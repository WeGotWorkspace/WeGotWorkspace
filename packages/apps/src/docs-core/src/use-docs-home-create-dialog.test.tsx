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
        groupRootNames: new Set(),
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
        groupRootNames: new Set(["eng"]),
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
        groupRootNames: new Set(),
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
        groupRootNames: new Set(),
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
        groupRootNames: new Set(),
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
        groupRootNames: new Set(),
      }),
    );
    act(() => {
      missing.result.current.handleCreateDocument();
    });
    expect(missing.result.current.createDialogOpen).toBe(false);
  });
});
