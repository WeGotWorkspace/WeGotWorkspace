import { describe, expect, it } from "vitest";
import { displayOriginHost } from "@/settings-core/src/display-origin-host";

describe("displayOriginHost", () => {
  it("strips the protocol from an https origin", () => {
    expect(displayOriginHost("https://chatgpt.com")).toBe("chatgpt.com");
    expect(displayOriginHost("https://claude.ai")).toBe("claude.ai");
  });

  it("keeps a non-default port", () => {
    expect(displayOriginHost("https://localhost:3000")).toBe("localhost:3000");
  });

  it("treats a bare host as https", () => {
    expect(displayOriginHost("chatgpt.com")).toBe("chatgpt.com");
  });
});
