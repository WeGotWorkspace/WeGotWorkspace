import { describe, expect, it } from "vitest";
import { meetJoinAlreadyEngaged, meetJoinIsEngaged } from "@/meet-core/src/meet-join-reuse";

describe("meetJoinAlreadyEngaged", () => {
  it("is true when the same room is already preparing, in-call, or waiting", () => {
    expect(meetJoinAlreadyEngaged("preparing", "chat-general", "chat-general")).toBe(true);
    expect(meetJoinAlreadyEngaged("in-call", "CHAT-GENERAL", "chat-general")).toBe(true);
    expect(meetJoinAlreadyEngaged("waiting", " chat-general ", "chat-general")).toBe(true);
  });

  it("is false when idle, failed, or targeting a different room", () => {
    expect(meetJoinAlreadyEngaged("idle", "chat-general", "chat-general")).toBe(false);
    expect(meetJoinAlreadyEngaged("failed", "chat-general", "chat-general")).toBe(false);
    expect(meetJoinAlreadyEngaged("in-call", "chat-a", "chat-b")).toBe(false);
    expect(meetJoinAlreadyEngaged("in-call", null, "chat-general")).toBe(false);
    expect(meetJoinAlreadyEngaged("in-call", "chat-general", "  ")).toBe(false);
  });
});

describe("meetJoinIsEngaged", () => {
  it("covers the live join window only", () => {
    expect(meetJoinIsEngaged("preparing")).toBe(true);
    expect(meetJoinIsEngaged("in-call")).toBe(true);
    expect(meetJoinIsEngaged("waiting")).toBe(true);
    expect(meetJoinIsEngaged("idle")).toBe(false);
    expect(meetJoinIsEngaged("failed")).toBe(false);
    expect(meetJoinIsEngaged(null)).toBe(false);
  });
});
