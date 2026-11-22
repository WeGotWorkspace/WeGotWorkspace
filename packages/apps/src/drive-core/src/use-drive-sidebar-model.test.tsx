import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { ViewKey } from "@/lib/files/drive-models";
import { useDriveSidebarModel } from "@/drive-core/src/use-drive-sidebar-model";

describe("useDriveSidebarModel", () => {
  const sidebarDropZoneProps = () => ({});
  const commitMoveToFolder = vi.fn();

  it("mirrors Docs primary order with All Files home and Team Drives + Personal", () => {
    const selectView = vi.fn();
    const { result, rerender } = renderHook(
      ({ view }: { view: ViewKey }) =>
        useDriveSidebarModel({
          labels: driveLabels,
          view,
          sidebarGroupRoots: [{ path: "Groups/eng", label: "Engineering" }],
          selectView,
          sidebarDropZoneProps,
          commitMoveToFolder,
        }),
      { initialProps: { view: { type: "folder", path: "My Drive" } as ViewKey } },
    );

    expect(result.current.primarySidebarItems.map((item) => item.label)).toEqual([
      "All Files",
      "Shared with me",
      "Recent",
      "Starred",
      "Trash",
    ]);
    // Personal is its own drive; All Files is the cross-drive home.
    expect(result.current.primarySidebarItems[0]?.selected).toBe(false);

    expect(result.current.groupSidebarItems.map((item) => item.label)).toEqual([
      "Personal",
      "Engineering",
    ]);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(true);

    result.current.primarySidebarItems[1]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "shared" });

    rerender({ view: { type: "all" } });
    expect(result.current.primarySidebarItems[0]?.selected).toBe(true);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(false);

    rerender({ view: { type: "shared" } });
    expect(result.current.primarySidebarItems[0]?.selected).toBe(false);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(false);
    expect(result.current.primarySidebarItems[1]?.selected).toBe(true);
  });

  it("shows Uploads next to Starred and Trash while the queue has files or the view is open", () => {
    const selectView = vi.fn();
    type Props = { view: ViewKey; uploads: { count: number; failed: number } | null };
    const { result, rerender } = renderHook(
      ({ view, uploads }: Props) =>
        useDriveSidebarModel({
          labels: driveLabels,
          view,
          uploads,
          sidebarGroupRoots: [],
          selectView,
          sidebarDropZoneProps,
          commitMoveToFolder,
        }),
      { initialProps: { view: { type: "folder", path: "My Drive" }, uploads: null } as Props },
    );
    const labels = () => result.current.primarySidebarItems.map((item) => item.label);
    expect(labels()).not.toContain("Uploads");

    rerender({ view: { type: "folder", path: "My Drive" }, uploads: { count: 3, failed: 1 } });
    expect(labels()).toEqual([
      "All Files",
      "Shared with me",
      "Recent",
      "Starred",
      "Uploads",
      "Trash",
    ]);
    const entry = result.current.primarySidebarItems[4]!;
    expect(entry.badge).toBeTruthy();
    entry.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "uploads" });

    // Queue empty while the view is open: the entry stays until the user leaves.
    rerender({ view: { type: "uploads" }, uploads: { count: 0, failed: 0 } });
    expect(labels()).toContain("Uploads");
    expect(result.current.primarySidebarItems[4]?.selected).toBe(true);
    expect(result.current.primarySidebarItems[4]?.badge).toBeNull();

    rerender({ view: { type: "folder", path: "My Drive" }, uploads: { count: 0, failed: 0 } });
    expect(labels()).not.toContain("Uploads");
  });

  describe("Projects section", () => {
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
        name: "Default",
        color: null,
        teamSlug: "eng",
        teamName: "Engineering",
        isDefault: true,
        archived: false,
        resources: {},
      },
      {
        id: "p3",
        name: "Site",
        color: null,
        teamSlug: "ops",
        teamName: "Operations",
        isDefault: false,
        archived: false,
        resources: { driveFolderId: "n3", driveFolderPath: "/groups/ops/Site" },
      },
    ] as never;

    const render = (selectedProjectIds: string[] | null, selectView = vi.fn()) =>
      renderHook(() =>
        useDriveSidebarModel({
          labels: driveLabels,
          view: { type: "folder", path: "Groups/eng/Launch" },
          sidebarGroupRoots: [],
          selectView,
          sidebarDropZoneProps,
          commitMoveToFolder,
          projects,
          selectedProjectIds,
        }),
      );

    it("lists Project folders, labelled by Team when there are several", () => {
      const { result } = render(null);
      expect(result.current.projectSidebarItems.map((i) => [i.label, i.description])).toEqual([
        ["Launch", "Engineering"],
        ["Site", "Operations"],
      ]);
      expect(result.current.projectSidebarItems[0]?.selected).toBe(true);
    });

    it("selects the Project, not also its Team drive, when a Project folder is open", () => {
      const { result } = renderHook(() =>
        useDriveSidebarModel({
          labels: driveLabels,
          view: { type: "folder", path: "Groups/eng/Launch" },
          sidebarGroupRoots: [{ path: "Groups/eng", label: "Engineering" }],
          selectView: vi.fn(),
          sidebarDropZoneProps,
          commitMoveToFolder,
          projects,
          selectedProjectIds: null,
        }),
      );
      expect(result.current.projectSidebarItems[0]?.selected).toBe(true);
      expect(
        result.current.groupSidebarItems.find((i) => i.label === "Engineering")?.selected,
      ).toBe(false);
    });

    it("narrows to the Projects in scope and drops the Team label", () => {
      const { result } = render(["p3"]);
      expect(result.current.projectSidebarItems.map((i) => [i.label, i.description])).toEqual([
        ["Site", undefined],
      ]);
    });

    it("opens the Project folder on select", () => {
      const selectView = vi.fn();
      const { result } = render(null, selectView);
      result.current.projectSidebarItems[1]?.onClick?.();
      expect(selectView).toHaveBeenCalledWith({ type: "folder", path: "Groups/ops/Site" });
    });
  });
});
