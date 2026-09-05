import { describe, expect, it } from "vitest";
import { meetTypingLabel } from "@/meet-core/src/meet-typing-label";

describe("meetTypingLabel", () => {
  it("returns null when nobody is typing", () => {
    expect(meetTypingLabel([])).toBeNull();
  });

  it("names a single typist", () => {
    expect(meetTypingLabel(["Ada Lovelace"])).toBe("Ada Lovelace is typing…");
  });

  it("names two typists", () => {
    expect(meetTypingLabel(["Ada Lovelace", "Grace Hopper"])).toBe(
      "Ada Lovelace and Grace Hopper are typing…",
    );
  });

  it("counts three or more typists", () => {
    expect(meetTypingLabel(["Ada", "Grace", "Alan"])).toBe("3 people are typing…");
  });
});
