/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  docsHrefFromApiPath,
  docsHrefFromNodeId,
  docsSearchFromApiPath,
  docsSearchFromNodeId,
  parseDocsRouteSearch,
} from "@/docs-core/src/docs-route-search";

describe("docs-route-search helpers", () => {
  it("docsHrefFromApiPath builds a /docs?file= query from an api path", () => {
    expect(docsHrefFromApiPath("/users/alice/Roadmap.md")).toBe(
      "/docs?file=users%2Falice%2FRoadmap.md",
    );
    expect(docsHrefFromApiPath("users/alice/Roadmap.md")).toBe(
      "/docs?file=users%2Falice%2FRoadmap.md",
    );
  });

  it("docsSearchFromApiPath strips the leading slash for the file param", () => {
    expect(docsSearchFromApiPath("/users/alice/Roadmap.md")).toEqual({
      file: "users/alice/Roadmap.md",
    });
  });

  it("keeps a valid FileNode id and drops a malformed one", () => {
    const id = `fn-${"a".repeat(32)}`;
    expect(parseDocsRouteSearch({ id })).toEqual({ id });
    expect(parseDocsRouteSearch({ id: id.toUpperCase().replace("FN-", "fn-") })).toEqual({ id });
    expect(parseDocsRouteSearch({ id: "fn-123", file: "users/a/b.md" })).toEqual({
      file: "users/a/b.md",
    });
    expect(parseDocsRouteSearch({ id: 42 })).toEqual({});
  });

  it("docsHrefFromNodeId builds a /docs?id= link", () => {
    const id = `fn-${"b".repeat(32)}`;
    expect(docsHrefFromNodeId(id)).toBe(`/docs?id=${id}`);
    expect(docsSearchFromNodeId(id)).toEqual({ id });
  });

  it("ignores former rtc debug search keys", () => {
    expect(
      parseDocsRouteSearch({
        file: "groups/administrators/team-notes.md",
        rtcDebug: 1,
        rtcForceRelay: 1,
      }),
    ).toEqual({
      file: "groups/administrators/team-notes.md",
    });
  });
});
