import { describe, expect, it } from "vitest";
import { chatThreadReplyCountLabel } from "@/chat-ui/src/chat-thread-reply-count";

describe("chatThreadReplyCountLabel", () => {
  it("labels an empty thread", () => {
    expect(chatThreadReplyCountLabel(0)).toBe("No replies yet");
  });

  it("labels a single reply", () => {
    expect(chatThreadReplyCountLabel(1)).toBe("1 reply");
  });

  it("labels multiple replies", () => {
    expect(chatThreadReplyCountLabel(3)).toBe("3 replies");
  });
});
