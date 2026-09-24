import { describe, expect, it } from "vitest";
import { meetThreadPeopleCount } from "@/meet-core/src/meet-thread-people";

describe("meetThreadPeopleCount", () => {
  it("counts unique authors across the root and one-level replies", () => {
    expect(meetThreadPeopleCount(null)).toBe(0);
    expect(meetThreadPeopleCount({ authorId: "a" })).toBe(1);
    expect(
      meetThreadPeopleCount({ authorId: "a" }, [
        { authorId: "b" },
        { authorId: "a" },
        { authorId: "c" },
      ]),
    ).toBe(3);
  });
});
