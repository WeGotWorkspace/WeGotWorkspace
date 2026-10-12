import { describe, expect, it } from "vitest";
import { createMeetPokeGate } from "@/meet-core/src/meet-poll-poke";

describe("createMeetPokeGate", () => {
  it("allows at most one poke per second on an injected clock", () => {
    let now = 1_000;
    const gate = createMeetPokeGate(() => now);

    expect(gate.allow()).toBe(true);
    now = 1_999;
    expect(gate.allow()).toBe(false);
    now = 2_000;
    expect(gate.allow()).toBe(true);
  });
});
