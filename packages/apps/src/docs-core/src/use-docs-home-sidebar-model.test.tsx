import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useDocsHomeSidebarModel } from "@/docs-core/src/use-docs-home-sidebar-model";

describe("useDocsHomeSidebarModel", () => {
  const drives = [
    { key: "users/alice", label: "My Drive", pathPrefix: "users/alice" },
    { key: "groups/eng", label: "eng", pathPrefix: "groups/eng" },
  ];

  it("selects All docs and Shared with me in the primary section", () => {
    const selectView = vi.fn();
    const { result, rerender } = renderHook(
      ({ view }) =>
        useDocsHomeSidebarModel({
          labels: docsLabels,
          drives,
          view,
          selectView,
        }),
      { initialProps: { view: { type: "all" as const } } },
    );

    expect(result.current.primaryItems.map((item) => item.label)).toEqual([
      "All docs",
      "Shared with me",
    ]);
    expect(result.current.primaryItems[0]?.selected).toBe(true);
    expect(result.current.primaryItems[1]?.selected).toBe(false);

    result.current.primaryItems[1]?.onClick?.({} as never);
    expect(selectView).toHaveBeenCalledWith({ type: "shared" });

    rerender({ view: { type: "shared" } });
    expect(result.current.primaryItems[0]?.selected).toBe(false);
    expect(result.current.primaryItems[1]?.selected).toBe(true);
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
    result.current.driveItems[0]?.onClick?.({} as never);
    expect(selectView).toHaveBeenCalledWith({ type: "drive", pathPrefix: "users/alice" });
  });
});
