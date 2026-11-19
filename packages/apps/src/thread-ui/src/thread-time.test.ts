import { describe, expect, it } from "vitest";
import { formatThreadTime } from "@/thread-ui/src/thread-time";

const now = Date.parse("2026-11-18T16:00:00Z");

describe("formatThreadTime", () => {
  it("says how long ago, then the date", () => {
    expect(formatThreadTime(now - 20_000, now)).toBe("just now");
    expect(formatThreadTime(now - 45 * 60_000, now)).toBe("45m ago");
    expect(formatThreadTime(now - 2 * 3_600_000, now)).toBe("2h ago");
    expect(formatThreadTime(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(formatThreadTime(Date.parse("2026-10-01T12:00:00Z"), now, "en-GB")).toBe("1 Oct");
    expect(formatThreadTime(Date.parse("2025-10-01T12:00:00Z"), now, "en-GB")).toBe("1 Oct 2025");
  });
});
