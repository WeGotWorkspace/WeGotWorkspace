import { describe, expect, it } from "vitest";
import { REFRESH_SPIN_CYCLE_MS, msUntilRefreshSpinComplete } from "@/refresh-spin/src/refresh-spin";

describe("msUntilRefreshSpinComplete", () => {
  const cycle = REFRESH_SPIN_CYCLE_MS;

  it("requires at least one full cycle from start", () => {
    expect(msUntilRefreshSpinComplete(0, 0, cycle)).toBe(cycle);
    expect(msUntilRefreshSpinComplete(0, 200, cycle)).toBe(800);
    expect(msUntilRefreshSpinComplete(0, cycle, cycle)).toBe(0);
  });

  it("rounds up to the next full cycle when ending mid-spin after the first", () => {
    expect(msUntilRefreshSpinComplete(0, cycle + 1, cycle)).toBe(cycle - 1);
    expect(msUntilRefreshSpinComplete(0, cycle * 2.5, cycle)).toBe(cycle / 2);
    expect(msUntilRefreshSpinComplete(0, cycle * 3, cycle)).toBe(0);
  });
});
