import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_CODE_URL, sourceCodeUrl } from "@/lib/source-code";

describe("sourceCodeUrl", () => {
  it("defaults to the upstream repository", () => {
    expect(sourceCodeUrl(undefined)).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl("  ")).toBe(DEFAULT_SOURCE_CODE_URL);
  });

  it("uses a configured http(s) URL", () => {
    expect(sourceCodeUrl(" https://git.example.org/hoster/wgw ")).toBe(
      "https://git.example.org/hoster/wgw",
    );
  });

  it("ignores values that are not http(s) URLs", () => {
    expect(sourceCodeUrl("javascript:alert(1)")).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl("not a url")).toBe(DEFAULT_SOURCE_CODE_URL);
  });
});
