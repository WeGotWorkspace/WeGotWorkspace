import { describe, expect, it } from "vitest";
import type { AdminMailDeliveryLastTestSend } from "@/lib/models/admin-types";
import { lastTestSendLabel } from "@/lib/models/admin-mail-delivery";

function testSend(fields: Partial<AdminMailDeliveryLastTestSend>): AdminMailDeliveryLastTestSend {
  return {
    accepted: true,
    status: "accepted_by_transport",
    transport: "smtp",
    at: "2026-11-16T10:00:00Z",
    message: null,
    ...fields,
  };
}

describe("lastTestSendLabel", () => {
  it("says no test was sent yet", () => {
    expect(lastTestSendLabel(null)).toBe(
      "No test send yet. A successful test means the transport accepted the message, not that it reached an inbox.",
    );
  });

  it("names the transport that accepted the test", () => {
    expect(lastTestSendLabel(testSend({ transport: "smtp" }))).toBe(
      "Last test send was accepted by the smtp transport. This does not confirm inbox placement.",
    );
  });

  it("says the selected transport when the accepted test names none", () => {
    expect(lastTestSendLabel(testSend({ transport: "" }))).toBe(
      "Last test send was accepted by the selected transport. This does not confirm inbox placement.",
    );
  });

  it("gives the failure status and transport when the test was not accepted", () => {
    expect(
      lastTestSendLabel(testSend({ accepted: false, status: "auth", transport: "smtp" })),
    ).toBe("Last test send was not accepted (auth, smtp).");
  });

  it("gives only the failure status when no transport was tried", () => {
    expect(
      lastTestSendLabel(testSend({ accepted: false, status: "unavailable", transport: "" })),
    ).toBe("Last test send was not accepted (unavailable).");
  });
});
