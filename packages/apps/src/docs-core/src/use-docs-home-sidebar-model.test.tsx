import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsHomeView } from "@/docs-core/src/docs-home-shared";
import { useDocsHomeSidebarModel } from "@/docs-core/src/use-docs-home-sidebar-model";

describe("useDocsHomeSidebarModel", () => {
  const drives = [
    { key: "users/alice", label: "Personal", pathPrefix: "users/alice" },
    { key: "groups/eng", label: "Engineering", pathPrefix: "groups/eng" },
  ];

  it("includes Recent, Starred, and Trash after Shared with me", () => {
    const selectView = vi.fn();
    const { result, rerender } = renderHook(
      ({ view }: { view: DocsHomeView }) =>
        useDocsHomeSidebarModel({
          labels: docsLabels,
          drives,
          view,
          selectView,
        }),
      { initialProps: { view: { type: "all" } as DocsHomeView } },
    );

    expect(result.current.primaryItems.map((item) => item.label)).toEqual([
      "All Docs",
      "Shared with me",
      "Recent",
      "Starred",
      "Trash",
    ]);
    // Docs has no upload queue: the shared order's Uploads entry stays hidden.
    expect(result.current.primaryItems.map((item) => item.label)).not.toContain("Uploads");
    expect(result.current.primaryItems[0]?.selected).toBe(true);
    expect(result.current.primaryItems[1]?.selected).toBe(false);

    result.current.primaryItems[1]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "shared" });

    rerender({ view: { type: "shared" } as DocsHomeView });
    expect(result.current.primaryItems[0]?.selected).toBe(false);
    expect(result.current.primaryItems[1]?.selected).toBe(true);

    result.current.primaryItems[2]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "recent" });
    result.current.primaryItems[3]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "starred" });
    result.current.primaryItems[4]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "trash" });
  });

  it("selects Recent, Starred, and Trash when those views are active", () => {
    const selectView = vi.fn();
    const { result, rerender } = renderHook(
      ({ view }: { view: DocsHomeView }) =>
        useDocsHomeSidebarModel({
          labels: docsLabels,
          drives,
          view,
          selectView,
        }),
      { initialProps: { view: { type: "recent" } as DocsHomeView } },
    );

    expect(result.current.primaryItems[2]?.selected).toBe(true);
    expect(result.current.primaryItems[2]?.icon).toBeTruthy();

    rerender({ view: { type: "starred" } });
    expect(result.current.primaryItems[3]?.selected).toBe(true);
    expect(result.current.primaryItems[3]?.icon).toBeTruthy();

    rerender({ view: { type: "trash" } });
    expect(result.current.primaryItems[4]?.selected).toBe(true);
    expect(result.current.primaryItems[4]?.icon).toBeTruthy();
  });

  it("selects a drive item when the drive view matches", () => {
    const selectView = vi.fn();
    const { result } = renderHook(() =>
      useDocsHomeSidebarModel({
        labels: docsLabels,
        drives,
        view: { type: "drive", pathPrefix: "groups/eng" },
        selectView,
      }),
    );

    expect(result.current.driveItems[0]?.selected).toBe(false);
    expect(result.current.driveItems[1]?.selected).toBe(true);
    result.current.driveItems[0]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "drive", pathPrefix: "users/alice" });
  });

  describe("Project folders", () => {
    const projects = [
      {
        id: "p1",
        name: "Launch",
        color: "#3366ff",
        teamSlug: "eng",
        teamName: "Engineering",
        isDefault: false,
        archived: false,
        resources: { driveFolderId: "n1", driveFolderPath: "/groups/eng/Launch" },
      },
      {
        id: "p2",
        name: "Engineering Project",
        color: null,
        teamSlug: "eng",
        teamName: "Engineering",
        isDefault: true,
        archived: false,
        resources: { driveFolderId: "n2", driveFolderPath: "/groups/eng/Engineering Project" },
      },
    ] as never;

    it("lists them in their own section, once, and selects only the open one", () => {
      const { result } = renderHook(() =>
        useDocsHomeSidebarModel({
          labels: docsLabels,
          drives: [
            ...drives,
            { key: "groups/eng/Launch", label: "Launch", pathPrefix: "groups/eng/Launch" },
          ],
          view: { type: "drive", pathPrefix: "groups/eng/Launch" } as DocsHomeView,
          selectView: vi.fn(),
          projects,
          selectedProjectIds: null,
        }),
      );
      expect(result.current.projectItems.map((item) => [item.label, item.selected])).toEqual([
        ["Launch", true],
        ["Engineering Project", false],
      ]);
      // The Team drive row stays; the Project folder is not repeated among the drives.
      expect(result.current.driveItems.map((item) => item.label)).toEqual([
        "Personal",
        "Engineering",
      ]);
      expect(result.current.driveItems.every((item) => !item.selected)).toBe(true);
    });

    it("narrows to the Projects in scope", () => {
      const { result } = renderHook(() =>
        useDocsHomeSidebarModel({
          labels: docsLabels,
          drives,
          view: { type: "all" } as DocsHomeView,
          selectView: vi.fn(),
          projects,
          selectedProjectIds: ["p2"],
        }),
      );
      expect(result.current.projectItems.map((item) => item.label)).toEqual([
        "Engineering Project",
      ]);
    });
  });
});
