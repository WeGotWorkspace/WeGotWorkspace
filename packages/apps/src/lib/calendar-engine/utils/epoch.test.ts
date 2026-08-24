import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { plainDateTimeToUtcMs, rangesOverlapMs, utcMsToPlainDateTime } from "./epoch.js";

describe("epoch helpers", () => {
  it("round-trips a floating PlainDateTime through UTC millis", () => {
    const value = Temporal.PlainDateTime.from("2026-08-18T09:30:15");
    expect(utcMsToPlainDateTime(plainDateTimeToUtcMs(value)).toString()).toBe(value.toString());
  });

  it("treats ranges as [start, end)", () => {
    expect(rangesOverlapMs(0, 10, 10, 20)).toBe(false);
    expect(rangesOverlapMs(0, 11, 10, 20)).toBe(true);
    expect(rangesOverlapMs(10, 10, 0, 20)).toBe(false);
  });
});
