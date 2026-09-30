import { describe, expect, it } from "vitest";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";

describe("mutationErrorMessage", () => {
  it("uses an Error message and otherwise the fallback", () => {
    expect(mutationErrorMessage(new Error("disk full"), "fallback")).toBe("disk full");
    expect(mutationErrorMessage("disk full", "fallback")).toBe("fallback");
  });
});
