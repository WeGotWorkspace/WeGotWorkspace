// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import {
  flushErrorDiagnostics,
  installErrorDiagnostics,
  recordUnexpectedError,
} from "@/lib/diagnostics/error-diagnostics-recorder";
import {
  ERROR_DIAGNOSTICS_DB_NAME,
  readErrorDiagnostics,
} from "@/lib/diagnostics/error-diagnostics-store";
import { formatErrorDiagnosticsText } from "@/lib/diagnostics/error-diagnostics-text";

let uninstall: (() => void) | null = null;

function dispatchError(error: unknown, message = error instanceof Error ? error.message : "") {
  window.dispatchEvent(new ErrorEvent("error", { error, message }));
}

function dispatchRejection(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/notes/all?search=diary#top");
  uninstall = installErrorDiagnostics(window);
});

afterEach(async () => {
  uninstall?.();
  uninstall = null;
  await flushErrorDiagnostics();
  await Dexie.delete(ERROR_DIAGNOSTICS_DB_NAME);
  vi.restoreAllMocks();
});

describe("installErrorDiagnostics", () => {
  it("records an uncaught error and an unhandled rejection", async () => {
    dispatchError(new TypeError("note.title is undefined"));
    dispatchRejection(new RangeError("Invalid time value"));
    await flushErrorDiagnostics();

    const rows = await readErrorDiagnostics();

    expect(rows.map((row) => [row.source, row.name, row.message])).toEqual([
      ["unhandledrejection", "RangeError", "Invalid time value"],
      ["error", "TypeError", "note.title is undefined"],
    ]);
    expect(rows[0]?.app).toBe("notes");
    expect(rows[0]?.route).toBe("/notes/all");
  });

  it("does not record failures the code already handles", async () => {
    dispatchRejection(new WgwRequestError("Forbidden", 403));
    dispatchRejection(new TypeError("Failed to fetch"));
    dispatchRejection(new DOMException("Aborted", "AbortError"));
    dispatchError(null, "ResizeObserver loop completed with undelivered notifications.");
    await flushErrorDiagnostics();

    expect(await readErrorDiagnostics()).toEqual([]);
  });

  it("records an error event that carries no error object by its message", async () => {
    dispatchError(null, "Script error.");
    await flushErrorDiagnostics();

    const rows = await readErrorDiagnostics();
    expect(rows.map((row) => row.message)).toEqual(["Script error."]);
  });

  it("stops listening when uninstalled", async () => {
    uninstall?.();
    uninstall = null;
    dispatchRejection(new Error("after uninstall"));
    await flushErrorDiagnostics();

    expect(await readErrorDiagnostics()).toEqual([]);
  });
});

describe("network", () => {
  it("records, reads and formats without making a network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, "open");
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, "send");
    const webSocket = vi.fn();
    vi.stubGlobal("WebSocket", webSocket);
    const eventSource = vi.fn();
    vi.stubGlobal("EventSource", eventSource);
    const image = vi.fn();
    vi.stubGlobal("Image", image);

    dispatchError(new Error("render failed"));
    dispatchRejection(new Error("save failed"));
    await recordUnexpectedError(new Error("boundary"), "render");
    await flushErrorDiagnostics();
    const text = formatErrorDiagnosticsText(await readErrorDiagnostics(), {
      build: "test",
      userAgent: "agent",
      copiedAt: new Date("2026-11-16T10:00:00.000Z"),
    });

    expect(text).toContain("render failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(xhrSend).not.toHaveBeenCalled();
    expect(webSocket).not.toHaveBeenCalled();
    expect(eventSource).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "sendBeacon");
  });
});
