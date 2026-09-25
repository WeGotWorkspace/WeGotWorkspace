import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import {
  useDocsHomeGroupRootEffects,
  useDocsHomeGroupRootModel,
} from "@/docs-core/src/use-docs-home-group-roots";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return {
    ...actual,
    wgwLiveApiEnabled: vi.fn(() => false),
    wgwFetch: vi.fn(),
    wgwReadJson: vi.fn(),
  };
});

import { wgwFetch, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";

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
  const model = useDocsHomeGroupRootModel({
    username: props.username ?? "alice",
    personalDriveLabel: "Personal",
  });
  useDocsHomeGroupRootEffects({
    operations: props.operations,
    online: props.online ?? true,
    files: props.files ?? [],
    setKnownGroupRoots: model.setKnownGroupRoots,
    setGroupDirectory: model.setGroupDirectory,
  });
  return model;
}

describe("useDocsHomeGroupRootEffects", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(false);
    vi.mocked(wgwFetch).mockReset();
    vi.mocked(wgwReadJson).mockReset();
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
    expect([...result.current.groupRootNames]).toEqual(["eng"]);

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
    expect(wgwFetch).not.toHaveBeenCalled();
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
    vi.mocked(wgwFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(wgwReadJson).mockResolvedValue({
      groups: [{ id: "principals/groups/eng", displayName: "Engineering" }],
    });

    const { result } = renderHook(() =>
      useHarness({ files: [doc("1", "/groups/eng/a.md")], online: true }),
    );

    await waitFor(() => {
      expect(result.current.drives.find((drive) => drive.pathPrefix === "groups/eng")?.label).toBe(
        "Engineering",
      );
    });
    expect(wgwFetch).toHaveBeenCalledWith(
      "/settings/state",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps the slug label when settings state is not ok", async () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwFetch).mockResolvedValue({ ok: false } as Response);

    const { result } = renderHook(() =>
      useHarness({ files: [doc("1", "/groups/eng/a.md")], online: true }),
    );

    await waitFor(() => {
      expect(wgwFetch).toHaveBeenCalled();
    });
    expect(result.current.drives.find((drive) => drive.pathPrefix === "groups/eng")?.label).toBe(
      "eng",
    );
    expect(wgwReadJson).not.toHaveBeenCalled();
  });
});
