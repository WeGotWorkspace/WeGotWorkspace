import { describe, expect, it } from "vitest";
import { parseDueDateValue } from "@/lib/models/task-fields";

describe("parseDueDateValue", () => {
  it("reads a date-only value as local midnight", () => {
    expect(parseDueDateValue("2026-11-16")).toEqual(new Date(2026, 10, 16));
  });

  it("reads a local date-time without seconds", () => {
    expect(parseDueDateValue("2026-11-16T09:30")).toEqual(new Date(2026, 10, 16, 9, 30, 0));
  });

  it("parses other date strings the platform understands", () => {
    expect(parseDueDateValue("Mon, 16 Nov 2026 09:30:00 GMT")?.toISOString()).toBe(
      "2026-11-16T09:30:00.000Z",
    );
  });

  it("is undefined for blank or unparseable values", () => {
    expect(parseDueDateValue(null)).toBeUndefined();
    expect(parseDueDateValue("  ")).toBeUndefined();
    expect(parseDueDateValue("next tuesday-ish")).toBeUndefined();
  });
});
