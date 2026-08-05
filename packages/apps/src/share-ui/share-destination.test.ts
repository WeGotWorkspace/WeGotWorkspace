import { describe, expect, it } from "vitest";
import {
  isShareTargetFile,
  shareDestination,
  shareDestinationHref,
  shareDestinationRoute,
  shareFileShouldDownload,
} from "@/share-ui/share-destination";

describe("shareDestinationRoute", () => {
  it("routes markdown shares to Docs with file search", () => {
    expect(shareDestinationRoute("/users/bob/Projects/report.md")).toEqual({
      to: "/docs",
      search: { file: "users/bob/Projects/report.md" },
    });
  });

  it("routes folder shares to Drive at the shared folder", () => {
    expect(shareDestinationRoute("/users/bob/Projects")).toEqual({
      to: "/drive",
      search: { view: "folder", path: "My Drive/Projects" },
    });
  });

  it("routes non-markdown files to Drive at the parent folder", () => {
    expect(shareDestinationRoute("/users/bob/Projects/plan.pdf")).toEqual({
      to: "/drive",
      search: { view: "folder", path: "My Drive/Projects" },
    });
  });
});

describe("shareDestination", () => {
  it("downloads non-previewable single-file shares such as VCF", () => {
    expect(shareDestination("/users/bob/contacts.vcf")).toEqual({
      kind: "download",
      apiPath: "/users/bob/contacts.vcf",
    });
  });

  it("opens previewable single-file shares in Drive", () => {
    expect(shareDestination("/users/bob/Projects/plan.pdf")).toEqual({
      kind: "route",
      route: {
        to: "/drive",
        search: { view: "folder", path: "My Drive/Projects" },
      },
    });
  });
});

describe("shareFileShouldDownload", () => {
  it("returns true for VCF and other non-previewable files", () => {
    expect(shareFileShouldDownload("/users/bob/contacts.vcf")).toBe(true);
    expect(shareFileShouldDownload("/users/bob/archive.zip")).toBe(true);
  });

  it("returns false for markdown, text, and media previews", () => {
    expect(shareFileShouldDownload("/users/bob/note.md")).toBe(false);
    expect(shareFileShouldDownload("/users/bob/readme.txt")).toBe(false);
    expect(shareFileShouldDownload("/users/bob/photo.png")).toBe(false);
    expect(shareFileShouldDownload("/users/bob/plan.pdf")).toBe(false);
  });
});

describe("isShareTargetFile", () => {
  it("detects file targets by extension", () => {
    expect(isShareTargetFile("/users/bob/contacts.vcf")).toBe(true);
    expect(isShareTargetFile("/users/bob/Projects")).toBe(false);
  });
});

describe("shareDestinationHref", () => {
  it("routes markdown shares to Docs", () => {
    expect(shareDestinationHref("/users/bob/Projects/report.md")).toBe(
      "/docs?file=users%2Fbob%2FProjects%2Freport.md",
    );
  });

  it("routes folder shares to Drive at the shared folder", () => {
    expect(shareDestinationHref("/users/bob/Projects")).toBe(
      "/drive?view=folder&path=My+Drive%2FProjects",
    );
  });

  it("routes non-markdown previewable files to Drive", () => {
    expect(shareDestinationHref("/users/bob/Projects/plan.pdf")).toBe(
      "/drive?view=folder&path=My+Drive%2FProjects",
    );
  });
});
