import { describe, expect, it } from "vitest";
import { AlertTriangle, CheckCircle2, CircleX } from "lucide-react";
import {
  appUrlFromBrowserLocation,
  formatByteCount,
  formatHumanDateTime,
  getServerCheckVisual,
  isProtectedGroup,
  parseUpdateLogLine,
} from "@/admin-core/src/admin-workspace-utils";

describe("appUrlFromBrowserLocation", () => {
  it("uses the origin at the site root and appends a base path", () => {
    expect(appUrlFromBrowserLocation("https://wgw.example", "/")).toBe("https://wgw.example");
    expect(appUrlFromBrowserLocation("https://wgw.example/", "/office/")).toBe(
      "https://wgw.example/office",
    );
  });
});

describe("getServerCheckVisual", () => {
  it("maps error statuses to failure visuals", () => {
    expect(getServerCheckVisual({ ok: false, status: "error" })).toEqual({
      Icon: CircleX,
      tone: "error",
    });
  });

  it("maps warnings and unknown detail to warning visuals", () => {
    expect(getServerCheckVisual({ ok: true, status: "warn" })).toEqual({
      Icon: AlertTriangle,
      tone: "warning",
    });
    expect(getServerCheckVisual({ ok: true, detail: "unknown provider" })).toEqual({
      Icon: AlertTriangle,
      tone: "warning",
    });
  });

  it("maps healthy checks to success visuals", () => {
    expect(getServerCheckVisual({ ok: true, status: "ok" })).toEqual({
      Icon: CheckCircle2,
      tone: "success",
    });
  });
});

describe("parseUpdateLogLine", () => {
  it("parses timestamped lines with level", () => {
    expect(parseUpdateLogLine("[2026-06-10 12:00:00] [ERROR] Disk full", 1)).toEqual({
      id: "1",
      date: "2026-06-10 12:00:00",
      level: "ERROR",
      message: "Disk full",
    });
  });

  it("parses timestamp-only lines as INFO", () => {
    expect(parseUpdateLogLine("[2026-06-10 12:00:00] Starting update", 2)).toEqual({
      id: "2",
      date: "2026-06-10 12:00:00",
      level: "INFO",
      message: "Starting update",
    });
  });

  it("returns plain text lines unchanged", () => {
    expect(parseUpdateLogLine("No timestamp here", 3)).toEqual({
      id: "3",
      date: null,
      level: "INFO",
      message: "No timestamp here",
    });
  });
});

describe("formatHumanDateTime", () => {
  it("formats valid timestamps and handles empty input", () => {
    expect(formatHumanDateTime(null)).toBe("-");
    expect(formatHumanDateTime("2026-06-10T10:00:00.000Z")).toMatch(/2026/);
    expect(formatHumanDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatByteCount", () => {
  it("formats byte counts with scaling units", () => {
    expect(formatByteCount(0)).toBe("0 B");
    expect(formatByteCount(1536)).toBe("1.5 KB");
    expect(formatByteCount(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("isProtectedGroup", () => {
  it("flags administrators group as protected", () => {
    expect(isProtectedGroup("principals/groups/administrators")).toBe(true);
    expect(isProtectedGroup("principals/groups/users")).toBe(false);
  });
});
