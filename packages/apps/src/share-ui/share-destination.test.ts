import { describe, expect, it } from "vitest";
import { shareDestinationHref, shareDestinationRoute } from "@/share-ui/share-destination";

describe("shareDestinationRoute", () => {
  it("routes markdown shares to Docs with file search", () => {
    expect(shareDestinationRoute("/users/bob/Projects/report.md")).toEqual({
      to: "/docs",
      search: { file: "users/bob/Projects/report.md" },
    });
  });

  it("routes folder shares to Drive shared view", () => {
    expect(shareDestinationRoute("/users/bob/Projects")).toEqual({
      to: "/drive",
      search: { view: "shared" },
    });
  });

  it("routes non-markdown files to Drive shared view", () => {
    expect(shareDestinationRoute("/users/bob/Projects/plan.pdf")).toEqual({
      to: "/drive",
      search: { view: "shared" },
    });
  });
});

describe("shareDestinationHref", () => {
  it("routes markdown shares to Docs", () => {
    expect(shareDestinationHref("/users/bob/Projects/report.md")).toBe(
      "/docs?file=users%2Fbob%2FProjects%2Freport.md",
    );
  });

  it("routes folder shares to Drive shared view", () => {
    expect(shareDestinationHref("/users/bob/Projects")).toBe("/drive?view=shared");
  });

  it("routes non-markdown files to Drive shared view", () => {
    expect(shareDestinationHref("/users/bob/Projects/plan.pdf")).toBe("/drive?view=shared");
  });
});
