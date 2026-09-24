import { describe, expect, it } from "vitest";
import { shouldSendChatOnEnter } from "@/chat-ui/src/chat-send-on-enter";

describe("shouldSendChatOnEnter", () => {
  it("sends on Enter without modifiers", () => {
    expect(shouldSendChatOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });

  it("keeps the newline on Shift+Enter", () => {
    expect(shouldSendChatOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });

  it("ignores IME compose and non-Enter keys", () => {
    expect(shouldSendChatOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(
      shouldSendChatOnEnter({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
    expect(shouldSendChatOnEnter({ key: "a", shiftKey: false })).toBe(false);
    expect(shouldSendChatOnEnter({ key: "Enter", shiftKey: false, metaKey: true })).toBe(false);
  });
});
