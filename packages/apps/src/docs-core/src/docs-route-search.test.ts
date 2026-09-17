/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  docsHrefFromApiPath,
  docsSearchFromApiPath,
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

  it("keeps rtcDebug on the docs search object so TanStack does not strip it", () => {
    expect(
      parseDocsRouteSearch({
        file: "groups/administrators/team-notes.md",
        rtcDebug: 1,
      }),
    ).toEqual({
      file: "groups/administrators/team-notes.md",
      rtcDebug: 1,
    });
  });

  it("preserves rtcDebug when building a file href from current search", () => {
    expect(docsHrefFromApiPath("/groups/administrators/team-notes.md", { rtcDebug: 1 })).toBe(
      "/docs?file=groups%2Fadministrators%2Fteam-notes.md&rtcDebug=1",
    );
  });

  it("parses a quoted leftover as the number 1 so the next serialize is unquoted", () => {
    expect(parseDocsRouteSearch({ file: "x.md", rtcDebug: '"1"' })).toEqual({
      file: "x.md",
      rtcDebug: 1,
    });
  });
});
