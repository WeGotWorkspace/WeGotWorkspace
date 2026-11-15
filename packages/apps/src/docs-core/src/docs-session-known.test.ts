import { describe, expect, it } from "vitest";
import { docsSessionKnown } from "@/docs-core/src/docs-session-known";

// A Doc joins its room once, under the person's own name (#2056).
describe("docsSessionKnown", () => {
  it("is not known on a first visit while the bootstrap loads", () => {
    expect(docsSessionKnown("loading", undefined)).toBe(false);
    expect(docsSessionKnown("loading", " ")).toBe(false);
  });

  it("is known from the cached session, also while a reload runs", () => {
    expect(docsSessionKnown("loading", "alice")).toBe(true);
  });

  it("is known once the bootstrap answered, with or without a user (mock mode)", () => {
    expect(docsSessionKnown("ready", undefined)).toBe(true);
    expect(docsSessionKnown("ready", "alice")).toBe(true);
  });
});
