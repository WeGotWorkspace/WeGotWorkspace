import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fullDriveMyRights } from "@/lib/api/mock/drive-mock-my-rights";
import { useDocsHomeSharedList } from "@/docs-core/src/use-docs-home-shared-list";

const connectivity = vi.hoisted(() => ({ online: true }));
vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: connectivity.online }),
}));

describe("useDocsHomeSharedList", () => {
  it("maps and filters shared entries when enabled", async () => {
    const listSharedWithMe = vi.fn().mockResolvedValue([
      {
        share: {
          id: "share-md",
          path: "/users/bob/Notes.md",
          kind: "member",
          defaultAccess: "view",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: null,
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Notes.md",
          path: "/users/bob/Notes.md",
          type: "file" as const,
          size: 10,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      {
        share: {
          id: "share-folder",
          path: "/users/bob/Folder",
          kind: "member",
          defaultAccess: "view",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: null,
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Folder",
          path: "/users/bob/Folder",
          type: "dir" as const,
          size: 0,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
    ]);

    const { result } = renderHook(() =>
      useDocsHomeSharedList({
        username: "alice",
        shareOperations: { listSharedWithMe },
        enabled: true,
        query: "",
      }),
    );

    await waitFor(() => {
      expect(listSharedWithMe).toHaveBeenCalled();
      expect(result.current.files.map((file) => file.title)).toEqual(["Notes.md"]);
      expect(result.current.loading).toBe(false);
    });
  });

  it("skips fetching when disabled", async () => {
    const listSharedWithMe = vi.fn();
    const { result } = renderHook(() =>
      useDocsHomeSharedList({
        username: "alice",
        shareOperations: { listSharedWithMe },
        enabled: false,
      }),
    );

    expect(listSharedWithMe).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("filters by query client-side", async () => {
    const listSharedWithMe = vi.fn().mockResolvedValue([
      {
        share: {
          id: "a",
          path: "/users/bob/Alpha.md",
          kind: "member",
          defaultAccess: "view",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: null,
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Alpha.md",
          path: "/users/bob/Alpha.md",
          type: "file" as const,
          size: 1,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
      {
        share: {
          id: "b",
          path: "/users/bob/Beta.txt",
          kind: "member",
          defaultAccess: "view",
          publicToken: null,
          hasPassword: false,
          expiresAt: null,
          updatedAt: null,
          shareWith: null,
          myRights: fullDriveMyRights,
        },
        entry: {
          name: "Beta.txt",
          path: "/users/bob/Beta.txt",
          type: "file" as const,
          size: 1,
          time: 1,
          permissions: 0,
          myRights: fullDriveMyRights,
        },
      },
    ]);

    const { result, rerender } = renderHook(
      ({ query }) =>
        useDocsHomeSharedList({
          username: "alice",
          shareOperations: { listSharedWithMe },
          enabled: true,
          query,
        }),
      { initialProps: { query: "" } },
    );

    await waitFor(() => expect(result.current.files).toHaveLength(2));

    rerender({ query: "beta" });
    expect(result.current.files.map((file) => file.title)).toEqual(["Beta.txt"]);
  });

  it("says Shared is not available offline instead of the fetch error (#1563)", async () => {
    connectivity.online = false;
    const listSharedWithMe = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() =>
      useDocsHomeSharedList({ username: "alice", shareOperations: { listSharedWithMe } }),
    );

    await waitFor(() =>
      expect(result.current.error).toBe("Shared documents are not available offline."),
    );
    connectivity.online = true;
  });

  it("says it too when the list loaded and the tab then went offline (#1563)", async () => {
    const listSharedWithMe = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(() =>
      useDocsHomeSharedList({ username: "alice", shareOperations: { listSharedWithMe } }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();

    connectivity.online = false;
    rerender();
    expect(result.current.error).toBe("Shared documents are not available offline.");
    connectivity.online = true;
  });
});
