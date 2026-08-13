import { describe, expect, it } from "vitest";
import { monthAnchorDate, yearAnchorDate } from "./timelineAnchorDates.js";

describe("monthAnchorDate", () => {
  it("maps month/year integers to the first day of that month", () => {
    expect(monthAnchorDate(2025, 1).toString()).toBe("2025-01-01");
    expect(monthAnchorDate(2025, 12).toString()).toBe("2025-12-01");
  });

  it("handles leap-year February like any other month (always day 1)", () => {
    expect(monthAnchorDate(2024, 2).toString()).toBe("2024-02-01");
  });

  it("constrains out-of-range months instead of throwing", () => {
    expect(monthAnchorDate(2025, 13).toString()).toBe("2025-12-01");
  });
});

describe("yearAnchorDate", () => {
  it("maps a year integer to January 1st of that year", () => {
    expect(yearAnchorDate(2025).toString()).toBe("2025-01-01");
    expect(yearAnchorDate(1999).toString()).toBe("1999-01-01");
  });
});
