import { describe, expect, it } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { docsHomeTreeView } from "@/docs-core/src/docs-home-config";
import { docsHomeHeaderTitle } from "@/docs-core/src/docs-home-workspace-model";

describe("Docs home tag view (#2402)", () => {
  it("lists the tree's tag view and is titled by the tag", () => {
    const view = { type: "tag", tag: "client-a" } as const;
    expect(docsHomeTreeView(view)).toEqual({ kind: "tag", tag: "client-a" });
    expect(docsHomeHeaderTitle(view, docsLabels, [])).toBe("client-a");
  });
});
