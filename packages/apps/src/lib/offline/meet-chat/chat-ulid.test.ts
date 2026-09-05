import { describe, expect, it } from "vitest";
import { createChatMessageUlid, isChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";

describe("createChatMessageUlid", () => {
  it("produces 26-char Crockford base32 ids", () => {
    const id = createChatMessageUlid();
    expect(id).toHaveLength(26);
    expect(isChatMessageUlid(id)).toBe(true);
  });

  it("is lexicographically monotonic within the same millisecond", () => {
    const now = Date.now();
    const ids = Array.from({ length: 50 }, () => createChatMessageUlid(now));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("orders by timestamp across milliseconds", () => {
    const earlier = createChatMessageUlid(1_000_000_000_000);
    const later = createChatMessageUlid(1_000_000_000_001);
    expect(earlier < later).toBe(true);
  });

  it("rejects non-ULID ids", () => {
    expect(isChatMessageUlid("local-abc")).toBe(false);
    expect(isChatMessageUlid("")).toBe(false);
  });
});
