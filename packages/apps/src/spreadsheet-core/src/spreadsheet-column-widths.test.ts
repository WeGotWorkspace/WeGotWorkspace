import { describe, expect, it } from "vitest";
import {
  appendAutoColumnWidth,
  columnHeaderLabel,
  columnHeaderRefBadge,
  MIN_COL_WIDTH,
  refreshAutoColumnWidths,
  resolveSheetColumnWidths,
} from "@/spreadsheet-core/src/spreadsheet-column-widths";

describe("column header badge", () => {
  it("hides badge for A-Z fallback columns even when ref casing differs from label", () => {
    expect(columnHeaderLabel({ ref: "a", name: "A" }, 0)).toBe("A");
    expect(columnHeaderRefBadge({ ref: "a", name: "A" }, 0)).toBe("");
  });

  it("shows badge when frontmatter ref differs from display name", () => {
    expect(columnHeaderLabel({ ref: "prijs", name: "Price", refExplicit: true }, 2)).toBe("Price");
    expect(columnHeaderRefBadge({ ref: "prijs", name: "Price", refExplicit: true }, 2)).toBe(
      "prijs",
    );
  });
});

describe("spreadsheet-column-widths", () => {
  it("preserves manual widths when auto widths refresh", () => {
    const auto = [90, 95, 100];
    const state = { widths: [120, 180, 200], manualCols: new Set([1]) };
    const refreshed = refreshAutoColumnWidths(state, auto);
    expect(refreshed.widths[0]).toBe(auto[0]);
    expect(refreshed.widths[1]).toBe(180);
    expect(refreshed.widths[2]).toBe(auto[2]);
    expect(refreshed.manualCols).toEqual(state.manualCols);
  });

  it("appends only the new column width on add column", () => {
    const existing = { widths: [100, 150, 130], manualCols: new Set([1]) };
    const next = appendAutoColumnWidth(existing, 88);
    expect(next.widths).toEqual([100, 150, 130, 88]);
    expect(next.manualCols).toEqual(existing.manualCols);
  });

  it("resolves stored widths ahead of auto widths for manual columns", () => {
    const auto = [90, 95, 100];
    const resolved = resolveSheetColumnWidths(3, auto, {
      widths: [120, 200, 100],
      manualCols: new Set([1]),
    });
    expect(resolved).toEqual([120, 200, 100]);
  });

  it("falls back to auto widths when no stored state exists", () => {
    const auto = [110, 120, 130];
    expect(resolveSheetColumnWidths(3, auto, undefined)).toEqual(auto);
  });

  it("uses minimum width when auto width is missing for an index", () => {
    expect(resolveSheetColumnWidths(2, [100], undefined)).toEqual([100, MIN_COL_WIDTH]);
  });
});
