import { describe, expect, it } from "vitest";
import { JmapRequestError, JmapSetItemError } from "@/lib/jmap-client";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";

describe("httpStatusFromFlushError", () => {
  it("maps a JMAP notFound set error to 404", () => {
    const error = new JmapSetItemError("update", "ev-1", { type: "notFound" });
    expect(httpStatusFromFlushError(error)).toBe(404);
  });

  it("maps a JMAP forbidden set error to 403", () => {
    const error = new JmapSetItemError("destroy", "note-1", { type: "forbidden" });
    expect(httpStatusFromFlushError(error)).toBe(403);
  });

  it("leaves other JMAP set types without a status", () => {
    const error = new JmapSetItemError("update", "ev-1", { type: "invalidProperties" });
    expect(httpStatusFromFlushError(error)).toBeUndefined();
  });

  it("reads status from a JMAP request error", () => {
    const error = new JmapRequestError("missing", { status: 404 });
    expect(httpStatusFromFlushError(error)).toBe(404);
  });

  it("returns undefined for a bare error", () => {
    expect(httpStatusFromFlushError(new Error("boom"))).toBeUndefined();
  });
});
