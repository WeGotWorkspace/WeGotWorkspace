import { describe, expect, it } from "vitest";
import { decideExternalWrite } from "./docs-collab-external-write";

describe("decideExternalWrite", () => {
  it("adopts a state that is still an ancestor", () => {
    expect(decideExternalWrite(false, false)).toBe("adopt");
    expect(decideExternalWrite(false, true)).toBe("adopt");
  });

  it("rebuilds when the outside text has no local unsaved work", () => {
    expect(decideExternalWrite(true, false)).toBe("rebuild");
  });

  it("asks the person when local work would otherwise be overwritten", () => {
    expect(decideExternalWrite(true, true)).toBe("prompt");
  });
});
