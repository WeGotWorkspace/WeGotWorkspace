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
