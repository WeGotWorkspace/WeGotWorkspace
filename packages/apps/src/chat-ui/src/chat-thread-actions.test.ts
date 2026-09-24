import { describe, expect, it, vi } from "vitest";
import {
  chatMessageCanOpenThread,
  omitChatNestedThreadActions,
} from "@/chat-ui/src/chat-thread-actions";

describe("chat thread nesting", () => {
  it("allows opening a thread from a main-channel message", () => {
    expect(chatMessageCanOpenThread({})).toBe(true);
    expect(chatMessageCanOpenThread({ parentId: null, threadId: "msg-1" })).toBe(true);
  });

  it("blocks a nested thread from a reply already in a thread", () => {
    expect(chatMessageCanOpenThread({ parentId: "msg-1", threadId: "msg-1" })).toBe(false);
  });

  it("omits Reply in thread from thread-panel actions", () => {
    const reply = { id: "reply" as const, onClick: vi.fn() };
    const react = { id: "react" as const, onClick: vi.fn() };
    expect(omitChatNestedThreadActions([reply, react])).toEqual([react]);
    expect(omitChatNestedThreadActions([reply])).toBeUndefined();
    expect(omitChatNestedThreadActions(undefined)).toBeUndefined();
  });
});
