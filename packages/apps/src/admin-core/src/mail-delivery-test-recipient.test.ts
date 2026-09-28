import { describe, expect, it } from "vitest";
import { isRecipientEmail } from "@/admin-core/src/mail-delivery-test-recipient";

describe("isRecipientEmail", () => {
  it("accepts an address with a dotted domain", () => {
    expect(isRecipientEmail("  ops@example.com ")).toBe(true);
  });

  it("rejects a value that is not an email", () => {
    expect(isRecipientEmail("ops")).toBe(false);
    expect(isRecipientEmail("ops@localhost")).toBe(false);
  });
});
