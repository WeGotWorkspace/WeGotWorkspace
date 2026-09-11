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
          sidebarGroupPaths: ["Groups/eng"],
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

    expect(result.current.groupSidebarItems.map((item) => item.label)).toEqual(["Personal", "eng"]);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(true);

    result.current.primarySidebarItems[1]?.onClick?.();
    expect(selectView).toHaveBeenCalledWith({ type: "shared" });

    rerender({ view: { type: "shared" } });
    expect(result.current.primarySidebarItems[0]?.selected).toBe(false);
    expect(result.current.groupSidebarItems[0]?.selected).toBe(false);
    expect(result.current.primarySidebarItems[1]?.selected).toBe(true);
  });
});
