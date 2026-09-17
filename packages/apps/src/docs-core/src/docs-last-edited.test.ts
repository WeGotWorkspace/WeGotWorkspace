import { afterEach, describe, expect, it, vi } from "vitest";
import { formatListDateTime } from "@/lib/datetime/format-list-date";
import { formatDocLastEdited } from "@/docs-core/src/docs-last-edited";

describe("formatDocLastEdited", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats ISO timestamps with the shared Notes list stamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const iso = new Date(2026, 5, 10, 8, 30, 0).toISOString();
    expect(formatDocLastEdited(iso)).toBe(formatListDateTime(iso));
  });

  it("returns empty when there is no real timestamp", () => {
    expect(formatDocLastEdited(null)).toBe("");
    expect(formatDocLastEdited(undefined)).toBe("");
    expect(formatDocLastEdited("")).toBe("");
    expect(formatDocLastEdited("—")).toBe("");
  });
});
