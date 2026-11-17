import { describe, expect, it } from "vitest";
import type { ErrorDiagnosticEntry } from "@/lib/diagnostics/error-diagnostics-store";
import { formatErrorDiagnosticsText } from "@/lib/diagnostics/error-diagnostics-text";

const header = {
  build: "0.1.124-beta.3 (abc1234)",
  userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
  copiedAt: new Date("2026-11-16T10:45:00.000Z"),
};

function row(overrides: Partial<ErrorDiagnosticEntry>): ErrorDiagnosticEntry {
  return {
    id: 1,
    time: "2026-11-16T10:42:00.000Z",
    source: "error",
    name: "TypeError",
    message: "items.map is not a function",
    stack: "TypeError: items.map is not a function\n    at List (/assets/drive-abc.js:10:5)",
    app: "drive",
    route: "/drive/folder",
    build: "0.1.124-beta.3 (abc1234)",
    userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
    count: 1,
    ...overrides,
  };
}

describe("formatErrorDiagnosticsText", () => {
  it("starts with build, browser and time copied, then one block per error", () => {
    const text = formatErrorDiagnosticsText(
      [
        row({ id: 2, count: 3, source: "unhandledrejection", app: "docs", route: "/docs/edit" }),
        row({ id: 1, stack: "" }),
      ],
      header,
    );

    expect(text).toBe(
      [
        "WeGotWorkspace diagnostics",
        "Build: 0.1.124-beta.3 (abc1234)",
        "Browser: Mozilla/5.0 (Macintosh) Safari/605.1.15",
        "Copied: 2026-11-16T10:45:00.000Z",
        "Errors: 2, newest first",
        "",
        "--- Error 1 ---",
        "Time: 2026-11-16T10:42:00.000Z (3 times, last shown)",
        "App: docs",
        "Route: /docs/edit",
        "Source: unhandled promise rejection",
        "Message: TypeError: items.map is not a function",
        "Stack:",
        "TypeError: items.map is not a function",
        "    at List (/assets/drive-abc.js:10:5)",
        "",
        "--- Error 2 ---",
        "Time: 2026-11-16T10:42:00.000Z",
        "App: drive",
        "Route: /drive/folder",
        "Source: uncaught error",
        "Message: TypeError: items.map is not a function",
        "Stack: (none)",
        "",
      ].join("\n"),
    );
  });

  it("names a build or browser that differs from the one copying", () => {
    const text = formatErrorDiagnosticsText(
      [row({ build: "0.1.123", userAgent: "Mozilla/5.0 (Windows) Firefox/140.0" })],
      header,
    );

    expect(text).toContain("Build: 0.1.123\n");
    expect(text).toContain("Browser: Mozilla/5.0 (Windows) Firefox/140.0\n");
  });

  it("says so when nothing is recorded", () => {
    expect(formatErrorDiagnosticsText([], header)).toContain(
      "Errors: none recorded on this device",
    );
  });
});
