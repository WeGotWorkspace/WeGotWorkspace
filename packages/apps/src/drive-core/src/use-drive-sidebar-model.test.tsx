import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { ViewKey } from "@/drive-core/src/drive-models";
import { useDriveSidebarModel } from "@/drive-core/src/use-drive-sidebar-model";

describe("useDriveSidebarModel", () => {
  const sidebarDropZoneProps = () => ({});
  const commitMoveToFolder = vi.fn();

  it("mirrors Docs primary order with My Files home and My Drives + Personal", () => {
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
      "My Files",
      "Shared with me",
      "Recent",
      "Starred",
      "Trash",
    ]);
    expect(result.current.primarySidebarItems[0]?.selected).toBe(true);

    expect(result.current.groupSidebarItems.map((item) => item.label)).toEqual([
      "Personal",
      "Engineering",
    ]);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(true);

    result.current.primarySidebarItems[1]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "shared" });

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
      "My Files",
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
});
