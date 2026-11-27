import { describe, expect, it } from "vitest";
import { mayWriteTags } from "@/drive-core/src/use-drive-tags";

describe("mayWriteTags (#2402)", () => {
  it("allows the owner, edit-level recipients and unknown rights; refuses view-level", () => {
    expect(mayWriteTags(true, true)).toBe(true);
    expect(mayWriteTags(false, true)).toBe(true);
    expect(mayWriteTags(true, false)).toBe(true);
    expect(mayWriteTags(undefined, undefined)).toBe(true);
    expect(mayWriteTags(false, false)).toBe(false);
    expect(mayWriteTags(false, undefined)).toBe(false);
  });
});
