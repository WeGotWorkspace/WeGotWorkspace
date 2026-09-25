import { describe, expect, it } from "vitest";
import {
  mailTestSendFeedback,
  normalizeMailTestRecipient,
} from "@/admin-core/src/admin-mail-delivery-test";
import type { AdminMailDeliveryLastTestSend } from "@/admin-core/src/admin-types";

describe("normalizeMailTestRecipient", () => {
  it("trims a recipient that contains @", () => {
    expect(normalizeMailTestRecipient("  ops@example.test  ")).toEqual({
      ok: true,
      recipient: "ops@example.test",
    });
  });

  it("rejects a blank or non-email recipient", () => {
    expect(normalizeMailTestRecipient("  ")).toEqual({
      ok: false,
      message: "A recipient email is required",
    });
    expect(normalizeMailTestRecipient("not-an-email")).toEqual({
      ok: false,
      message: "A recipient email is required",
    });
  });
});

describe("mailTestSendFeedback", () => {
  const last = (patch: Partial<AdminMailDeliveryLastTestSend>): AdminMailDeliveryLastTestSend => ({
    accepted: false,
    status: "connect",
    transport: "smtp",
    at: "2026-09-25T00:00:00.000Z",
    message: null,
    ...patch,
  });

  it("reports transport acceptance separately from inbox placement", () => {
    expect(mailTestSendFeedback(last({ accepted: true, message: "queued" }))).toEqual({
      kind: "success",
      message: "Test send accepted by the transport (not inbox placement)",
    });
  });

  it("prefers the server message, then status, then unavailable", () => {
    expect(mailTestSendFeedback(last({ message: "auth failed" }))).toEqual({
      kind: "error",
      message: "auth failed",
    });
    expect(mailTestSendFeedback(last({ status: "timeout" }))).toEqual({
      kind: "error",
      message: "Test send failed (timeout)",
    });
    expect(mailTestSendFeedback(null)).toEqual({
      kind: "error",
      message: "Test send failed (unavailable)",
    });
  });
});
