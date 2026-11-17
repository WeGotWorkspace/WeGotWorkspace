import { describe, expect, it } from "vitest";
import {
  ERROR_DIAGNOSTIC_MESSAGE_MAX,
  ERROR_DIAGNOSTIC_STACK_MAX,
  buildErrorDiagnostic,
  scrubUrls,
  type ErrorDiagnosticContext,
} from "@/lib/diagnostics/error-diagnostics-entry";

const context: ErrorDiagnosticContext = {
  pathname: "/drive/folder/reports",
  build: "0.1.124-beta.3 (abc1234)",
  userAgent: "test-agent",
  now: new Date("2026-11-16T10:42:00.000Z"),
};

describe("buildErrorDiagnostic", () => {
  it("records message, stack, app, route, build, browser and time", () => {
    const error = new TypeError("items.map is not a function");
    error.stack = "TypeError: items.map is not a function\n    at List (/assets/drive-abc.js:10:5)";

    expect(buildErrorDiagnostic(error, "error", context)).toEqual({
      time: "2026-11-16T10:42:00.000Z",
      source: "error",
      name: "TypeError",
      message: "items.map is not a function",
      stack: "TypeError: items.map is not a function\n    at List (/assets/drive-abc.js:10:5)",
      app: "drive",
      route: "/drive/folder/reports",
      build: "0.1.124-beta.3 (abc1234)",
      userAgent: "test-agent",
    });
  });

  it("names the home screen when the path has no app segment", () => {
    expect(buildErrorDiagnostic(new Error("x"), "error", { ...context, pathname: "/" }).app).toBe(
      "home",
    );
  });

  it("keeps no query string or fragment in the route, message or stack", () => {
    const error = new Error(
      "GET https://cloud.example.test/api/v1/files?path=/Taxes/2026.pdf&token=s3cret#preview failed",
    );
    error.stack = [
      "Error: GET https://cloud.example.test/api/v1/files?path=/Taxes/2026.pdf&token=s3cret#preview failed",
      "    at load (https://cloud.example.test/assets/index-abc.js?v=42:12:3)",
      "    at open@https://cloud.example.test/src/drive.tsx?t=1700000000:7:1",
      "    at relative (/api/v1/docs?node=secret-name#heading)",
    ].join("\n");

    const entry = buildErrorDiagnostic(error, "unhandledrejection", {
      ...context,
      pathname: "/docs/edit?file=Salary%20review.docx#comments",
    });

    const recorded = JSON.stringify(entry);
    expect(recorded).not.toContain("token");
    expect(recorded).not.toContain("s3cret");
    expect(recorded).not.toContain("Taxes");
    expect(recorded).not.toContain("Salary");
    expect(recorded).not.toContain("secret-name");
    expect(recorded).not.toContain("#");
    expect(recorded).not.toContain("?");
    expect(entry.route).toBe("/docs/edit");
    expect(entry.message).toBe("GET https://cloud.example.test/api/v1/files failed");
    expect(entry.stack).toContain("(https://cloud.example.test/assets/index-abc.js:12:3)");
    expect(entry.stack).toContain("open@https://cloud.example.test/src/drive.tsx:7:1");
    expect(entry.stack).toContain("(/api/v1/docs)");
  });

  it("does not copy the fields of a rejected object, such as a request body", () => {
    const rejected = {
      body: '{"title":"Board minutes","content":"Private text"}',
      status: 500,
    };

    const entry = buildErrorDiagnostic(rejected, "unhandledrejection", context);

    expect(entry.name).toBe("NonError");
    expect(entry.message).toBe("A promise was rejected with a non-error value (object).");
    expect(entry.stack).toBe("");
    expect(JSON.stringify(entry)).not.toContain("Board minutes");
    expect(JSON.stringify(entry)).not.toContain("Private text");
  });

  it("keeps the extra properties of an Error out of the entry", () => {
    const error = Object.assign(new Error("save failed"), {
      requestBody: "<p>Document content</p>",
      response: { text: "Server body" },
    });

    const recorded = JSON.stringify(buildErrorDiagnostic(error, "error", context));

    expect(recorded).not.toContain("Document content");
    expect(recorded).not.toContain("Server body");
  });

  it("caps a long message and a long stack", () => {
    const error = new Error("m".repeat(ERROR_DIAGNOSTIC_MESSAGE_MAX * 2));
    error.stack = "s".repeat(ERROR_DIAGNOSTIC_STACK_MAX * 2);

    const entry = buildErrorDiagnostic(error, "error", context);

    expect(entry.message.length).toBeLessThanOrEqual(ERROR_DIAGNOSTIC_MESSAGE_MAX);
    expect(entry.stack.length).toBeLessThanOrEqual(ERROR_DIAGNOSTIC_STACK_MAX);
    expect(entry.message.endsWith("…")).toBe(true);
  });
});

describe("scrubUrls", () => {
  it("leaves text without a URL alone", () => {
    expect(scrubUrls("Cannot read properties of undefined (reading 'id')")).toBe(
      "Cannot read properties of undefined (reading 'id')",
    );
  });

  it("drops the query and fragment of a websocket URL", () => {
    expect(scrubUrls("wss://cloud.example.test/collab/room?ticket=abc closed")).toBe(
      "wss://cloud.example.test/collab/room closed",
    );
  });
});
