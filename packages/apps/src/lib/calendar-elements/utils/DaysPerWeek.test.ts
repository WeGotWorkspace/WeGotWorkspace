import { describe, expect, it } from "vitest";
import {
  clampAgendaDaysPerWeek,
  clampDaysPerWeek,
  clampGridDaysPerWeek,
  daysPerWeekFromInput,
} from "./DaysPerWeek.js";

describe("daysPerWeekFromInput", () => {
  it("floors finite numbers", () => {
    expect(daysPerWeekFromInput(3)).toBe(3);
    expect(daysPerWeekFromInput(3.9)).toBe(3);
  });

  it("parses numeric strings after trimming", () => {
    expect(daysPerWeekFromInput(" 5 ")).toBe(5);
    expect(daysPerWeekFromInput("5.7")).toBe(5);
  });

  it("returns NaN for values it cannot read as a day count", () => {
    expect(daysPerWeekFromInput(undefined)).toBeNaN();
    expect(daysPerWeekFromInput(null)).toBeNaN();
    expect(daysPerWeekFromInput("")).toBeNaN();
    expect(daysPerWeekFromInput("   ")).toBeNaN();
    expect(daysPerWeekFromInput("three")).toBeNaN();
    expect(daysPerWeekFromInput(Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe("clampDaysPerWeek", () => {
  it("keeps values inside the 1..7 week range", () => {
    expect(clampDaysPerWeek(1)).toBe(1);
    expect(clampDaysPerWeek(3)).toBe(3);
    expect(clampDaysPerWeek(7)).toBe(7);
  });

  it("clamps out-of-range values to the nearest bound", () => {
    expect(clampDaysPerWeek(0)).toBe(1);
    expect(clampDaysPerWeek(99)).toBe(7);
  });

  it("falls back to a full week for NaN", () => {
    expect(clampDaysPerWeek(Number.NaN)).toBe(7);
  });
});

describe("clampGridDaysPerWeek", () => {
  it("allows a full six-week grid", () => {
    expect(clampGridDaysPerWeek(42)).toBe(42);
    expect(clampGridDaysPerWeek(43)).toBe(42);
    expect(clampGridDaysPerWeek(0)).toBe(1);
  });

  it("falls back to a week for NaN", () => {
    expect(clampGridDaysPerWeek(Number.NaN)).toBe(7);
  });
});

describe("clampAgendaDaysPerWeek", () => {
  it("allows up to a leap year of days", () => {
    expect(clampAgendaDaysPerWeek(366)).toBe(366);
    expect(clampAgendaDaysPerWeek(1000)).toBe(366);
    expect(clampAgendaDaysPerWeek(0)).toBe(1);
  });

  it("falls back to a month for NaN", () => {
    expect(clampAgendaDaysPerWeek(Number.NaN)).toBe(31);
  });
});
