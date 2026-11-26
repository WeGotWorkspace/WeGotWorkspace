import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { DriveFile } from "@/lib/files/drive-models";
import { useDocsHomeGroupRoots } from "@/docs-core/src/use-docs-home-group-roots";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return {
    ...actual,
    wgwLiveApiEnabled: vi.fn(() => false),
    wgwSettingsStateRead: { read: vi.fn() },
  };
});

vi.mock("@/lib/files/team-labels/team-label-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/files/team-labels/team-label-store")>();
  return {
    ...actual,
    readCachedTeamDisplayNames: vi.fn(async () => []),
    writeCachedTeamDisplayNames: vi.fn(async () => {}),
  };
});

import { wgwLiveApiEnabled, wgwSettingsStateRead } from "@/lib/api/wgw/http";
import {
  readCachedTeamDisplayNames,
  writeCachedTeamDisplayNames,
} from "@/lib/files/team-labels/team-label-store";

function doc(id: string, apiPath: string): DriveFile {
  return {
    id,
    category: "document",
    date: "Now",
    title: id,
    excerpt: "",
    body: [],
    notebook: "",
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "doc",
    size: "—",
    apiPath,
  };
}

function useHarness(props: {
  username?: string;
  online?: boolean;
  files?: DriveFile[];
  operations?: DriveAPIOperations;
}) {
  const model = useDocsHomeGroupRoots({
    username: props.username ?? "alice",
    personalDriveLabel: "Personal",
    operations: props.operations,
    online: props.online ?? true,
  });
  const { discoverFromFiles } = model;
  const files = props.files;
  useEffect(() => {
    discoverFromFiles(files ?? []);
  }, [discoverFromFiles, files]);
  return model;
}

describe("useDocsHomeGroupRoots", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(false);
    vi.mocked(wgwSettingsStateRead.read).mockReset();
    vi.mocked(readCachedTeamDisplayNames).mockResolvedValue([]);
    vi.mocked(writeCachedTeamDisplayNames).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("collects group roots from loaded files and keeps the same roots when they repeat", () => {
    const { result, rerender } = renderHook(
      ({ files }: { files: DriveFile[] }) => useHarness({ files, online: false }),
      { initialProps: { files: [doc("1", "/groups/eng/a.md")] } },
    );

    expect(result.current.drives.map((drive) => drive.pathPrefix)).toEqual([
      "users/alice",
      "groups/eng",
    ]);
    expect(result.current.groupRootSlugs).toEqual(["eng"]);

    const roots = result.current.labeledGroupRoots;
    rerender({ files: [doc("2", "/groups/eng/b.md")] });
    expect(result.current.labeledGroupRoots).toBe(roots);
  });

  it("does not list /groups while offline", () => {
    const listDirectory = vi.fn();
    renderHook(() =>
      useHarness({
        online: false,
        files: [doc("1", "/groups/eng/a.md")],
        operations: { listDirectory } as unknown as DriveAPIOperations,
      }),
    );
    expect(listDirectory).not.toHaveBeenCalled();
    expect(wgwSettingsStateRead.read).not.toHaveBeenCalled();
  });

  it("discovers group drives from the live /groups listing", async () => {
    const listDirectory = vi.fn(async () => ({
      directory: {
        files: [{ path: "/groups/design", type: "dir", name: "Design" }],
      },
    }));
    const { result } = renderHook(() =>
      useHarness({
        operations: { listDirectory } as unknown as DriveAPIOperations,
        files: [],
      }),
    );

    await waitFor(() => {
      expect(result.current.drives.map((drive) => [drive.pathPrefix, drive.label])).toEqual([
        ["users/alice", "Personal"],
        ["groups/design", "Design"],
      ]);
    });
    expect(listDirectory).toHaveBeenCalledWith(
      "/groups",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("overlays settings display names onto path-discovered roots", async () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwSettingsStateRead.read).mockResolvedValue({
      ok: true,
      status: 200,
      json: { groups: [{ id: "principals/groups/eng", displayName: "Engineering" }] },
    });

    const { result } = renderHook(() =>
      useHarness({ files: [doc("1", "/groups/eng/a.md")], online: true }),
    );

    await waitFor(() => {
      expect(result.current.drives.find((drive) => drive.pathPrefix === "groups/eng")?.label).toBe(
        "Engineering",
      );
    });
    expect(wgwSettingsStateRead.read).toHaveBeenCalled();
  });

  it("keeps the slug label when settings state is not ok", async () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwSettingsStateRead.read).mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useHarness({ files: [doc("1", "/groups/eng/a.md")], online: true }),
    );

    await waitFor(() => {
      expect(wgwSettingsStateRead.read).toHaveBeenCalled();
    });
    expect(result.current.drives.find((drive) => drive.pathPrefix === "groups/eng")?.label).toBe(
      "eng",
    );
  });

  it("caches the settings display names for this account", async () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    const groups = [{ id: "principals/groups/eng", displayName: "Engineering" }];
    vi.mocked(wgwSettingsStateRead.read).mockResolvedValue({
      ok: true,
      status: 200,
      json: { groups },
    });

    renderHook(() => useHarness({ files: [], online: true }));

    await waitFor(() => {
      expect(writeCachedTeamDisplayNames).toHaveBeenCalledWith("alice", groups);
    });
  });

  it("offline, lists every cached team drive with its display name (#2063)", async () => {
    vi.mocked(readCachedTeamDisplayNames).mockResolvedValue([
      { id: "principals/groups/e2e-notes-team", displayName: "E2E Notes Team" },
      { id: "principals/groups/eng", displayName: "Engineering" },
    ]);

    const { result } = renderHook(() =>
      useHarness({ files: [doc("1", "/groups/eng/a.md")], online: false }),
    );

    await waitFor(() => {
      expect(result.current.drives.map((drive) => [drive.pathPrefix, drive.label])).toEqual([
        ["users/alice", "Personal"],
        ["groups/e2e-notes-team", "E2E Notes Team"],
        ["groups/eng", "Engineering"],
      ]);
    });
    expect(wgwSettingsStateRead.read).not.toHaveBeenCalled();
  });
});
