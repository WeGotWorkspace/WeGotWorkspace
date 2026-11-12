import { describe, expect, it } from "vitest";
import {
  WORKSPACE_LIST_OVERSCAN_PX,
  WORKSPACE_LIST_UNSIZED_ROWS,
  WORKSPACE_LIST_WINDOW_AFTER,
  listRowOffsets,
  listWindowRange,
  listWindowSegments,
  mountedRowCount,
  sectionHeaderIndex,
} from "./workspace-list-window";

function evenOffsets(count: number, size = 100) {
  return listRowOffsets(Array.from({ length: count }, () => size));
}

describe("listWindowRange", () => {
  it("renders a short list in full", () => {
    const offsets = evenOffsets(WORKSPACE_LIST_WINDOW_AFTER);
    expect(listWindowRange(offsets, 3000, 400)).toEqual({ start: 0, end: 80 });
    expect(listWindowSegments(offsets, { start: 0, end: 80 })).toEqual([
      { kind: "rows", start: 0, end: 80 },
    ]);
  });

  it("renders the first rows while the scrollport has no height", () => {
    expect(listWindowRange(evenOffsets(1000), 0, 0)).toEqual({
      start: 0,
      end: WORKSPACE_LIST_UNSIZED_ROWS,
    });
  });

  it("windows a long list to the scrollport plus overscan", () => {
    const offsets = evenOffsets(1000);
    const range = listWindowRange(offsets, 50_000, 800);
    const from = 50_000 - WORKSPACE_LIST_OVERSCAN_PX;
    const to = 50_000 + 800 + WORKSPACE_LIST_OVERSCAN_PX;
    expect(offsets[range.start + 1]!).toBeGreaterThan(from);
    expect(offsets[range.start]!).toBeLessThanOrEqual(from);
    expect(offsets[range.end - 1]!).toBeLessThanOrEqual(to);
    expect(offsets[range.end]!).toBeGreaterThan(to);
  });

  it("matches a linear scan with rows of different heights", () => {
    const sizes = Array.from({ length: 500 }, (_, index) => 40 + ((index * 37) % 90));
    const offsets = listRowOffsets(sizes);
    for (const top of [0, 1234, 9999, 20_000, offsets[500]! - 300]) {
      const range = listWindowRange(offsets, top, 600, 200);
      const visible = sizes
        .map((_, index) => index)
        .filter(
          (index) => offsets[index + 1]! > Math.max(0, top - 200) && offsets[index]! <= top + 800,
        );
      expect(range).toEqual({ start: visible[0], end: visible[visible.length - 1]! + 1 });
    }
  });

  it("stops at the end of the list", () => {
    const offsets = evenOffsets(200);
    expect(listWindowRange(offsets, 19_600, 800).end).toBe(200);
  });
});

describe("listWindowSegments", () => {
  it("puts spacers of the right size around the window", () => {
    const offsets = evenOffsets(1000);
    const segments = listWindowSegments(offsets, { start: 100, end: 120 });
    expect(segments).toEqual([
      { kind: "gap", size: 10_000 },
      { kind: "rows", start: 100, end: 120 },
      { kind: "gap", size: 88_000 },
    ]);
    expect(mountedRowCount(segments)).toBe(20);
  });

  it("mounts pinned rows at their own offset, before and after the window", () => {
    const offsets = evenOffsets(1000);
    expect(listWindowSegments(offsets, { start: 100, end: 120 }, [5, 900, 110])).toEqual([
      { kind: "gap", size: 500 },
      { kind: "rows", start: 5, end: 6 },
      { kind: "gap", size: 9_400 },
      { kind: "rows", start: 100, end: 120 },
      { kind: "gap", size: 78_000 },
      { kind: "rows", start: 900, end: 901 },
      { kind: "gap", size: 9_900 },
    ]);
  });

  it("joins a pinned row that touches the window", () => {
    const offsets = evenOffsets(1000);
    expect(listWindowSegments(offsets, { start: 100, end: 120 }, [99, 120])).toEqual([
      { kind: "gap", size: 9_900 },
      { kind: "rows", start: 99, end: 121 },
      { kind: "gap", size: 87_900 },
    ]);
  });

  it("keeps the total height whatever is mounted", () => {
    const sizes = Array.from({ length: 300 }, (_, index) => 30 + (index % 7) * 11);
    const offsets = listRowOffsets(sizes);
    const segments = listWindowSegments(offsets, { start: 40, end: 70 }, [2, 250]);
    let total = 0;
    for (const segment of segments) {
      if (segment.kind === "gap") total += segment.size;
      else for (let index = segment.start; index < segment.end; index += 1) total += sizes[index]!;
    }
    expect(total).toBe(offsets[300]);
  });
});

describe("sectionHeaderIndex", () => {
  it("finds the header that opens a row's section", () => {
    const headers = new Set([0, 10, 40]);
    expect(sectionHeaderIndex(25, (index) => headers.has(index))).toBe(10);
    expect(sectionHeaderIndex(40, (index) => headers.has(index))).toBe(40);
    expect(sectionHeaderIndex(5, undefined)).toBe(-1);
  });
});
