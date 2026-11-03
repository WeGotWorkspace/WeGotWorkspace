import { describe, expect, it } from "vitest";
import { canLocalAck } from "./local-ack-gate";

describe("canLocalAck", () => {
  it("acks from a visible window", () => {
    expect(canLocalAck("visible", false)).toBe(true);
    expect(canLocalAck("visible", true)).toBe(true);
  });

  it("does not ack from a hidden window outside a Meet call", () => {
    expect(canLocalAck("hidden", false)).toBe(false);
  });

  it("acks from a hidden window while the user is in a Meet call", () => {
    expect(canLocalAck("hidden", true)).toBe(true);
  });
});
