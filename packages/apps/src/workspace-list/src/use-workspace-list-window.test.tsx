import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceListWindow } from "@/workspace-list/src/use-workspace-list-window";

const focus = vi.hoisted(() => ({ focusedKey: null as string | null }));

vi.mock("@/workspace-list/src/use-workspace-list-pinned", () => ({
  useWorkspaceListPinnedKeys: () => ({ focusedKey: focus.focusedKey, draggingKey: null }),
}));
vi.mock("@/workspace-list/src/use-workspace-list-measure", async () => {
  const { listRowOffsets } = await import("@/workspace-list/src/workspace-list-window");
  return {
    useWorkspaceListRowSizes: (_keys: readonly string[], estimates: readonly number[]) => ({
      offsets: listRowOffsets(estimates),
      measuredRef: { current: new Map() },
      bump: () => {},
    }),
    useMeasureMountedRows: () => {},
  };
});
// The window sits at the end of the list, far from the focused row.
vi.mock("@/workspace-list/src/use-workspace-list-scroll", () => ({
  useWorkspaceListScroll: () => ({ scroller: null, range: { start: 190, end: 200 } }),
}));

type Row = { key: string; header?: boolean };

function mountedKeys(rows: Row[], focusedKey: string) {
  focus.focusedKey = focusedKey;
  const { result } = renderHook(() =>
    useWorkspaceListWindow({
      items: rows,
      keys: rows.map((row) => row.key),
      estimateSize: () => 40,
      isHeader: (row) => row.header === true,
      pinnedKeys: [],
    }),
  );
  const mounted = new Set<string>();
  for (const segment of result.current.segments) {
    if (segment.kind !== "rows") continue;
    for (let index = segment.start; index < segment.end; index += 1) mounted.add(rows[index]!.key);
  }
  return mounted;
}

describe("useWorkspaceListWindow pinning across section headings", () => {
  const rows: Row[] = [
    { key: "folders", header: true },
    ...Array.from({ length: 99 }, (_, i) => ({ key: `folder-${i}` })),
    { key: "files", header: true },
    ...Array.from({ length: 100 }, (_, i) => ({ key: `file-${i}` })),
  ];

  it("keeps the first item row after a heading mounted when the row before it is focused", () => {
    const mounted = mountedKeys(rows, "folder-98");
    expect(mounted.has("file-0")).toBe(true);
    expect(mounted.has("file-1")).toBe(false);
  });

  it("keeps the last item row before a heading mounted when the row after it is focused", () => {
    const mounted = mountedKeys(rows, "file-0");
    expect(mounted.has("folder-98")).toBe(true);
    expect(mounted.has("folder-97")).toBe(false);
  });
});
