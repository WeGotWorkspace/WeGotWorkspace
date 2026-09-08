import { describe, expect, it } from "vitest";
import { chatFileKindFromName } from "@/chat-ui/src/chat-file-kind";

describe("chatFileKindFromName", () => {
  it("maps common extensions and falls back to file", () => {
    expect(chatFileKindFromName("Brief.pdf")).toBe("file");
    expect(chatFileKindFromName("Sprint notes.md")).toBe("doc");
    expect(chatFileKindFromName("cover.png")).toBe("image");
    expect(chatFileKindFromName("clip.mp4")).toBe("video");
    expect(chatFileKindFromName("notes")).toBe("file");
    expect(chatFileKindFromName(undefined)).toBe("file");
  });
});
