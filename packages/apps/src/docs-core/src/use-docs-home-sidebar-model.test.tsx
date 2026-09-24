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
      "My Docs",
      "Shared with me",
      "Recent",
      "Starred",
      "Trash",
    ]);
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
});
