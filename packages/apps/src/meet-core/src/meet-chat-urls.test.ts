import { describe, expect, it } from "vitest";
import { extractChatUrls, mapChatPreviews, normalizeChatUrl } from "@/meet-core/src/meet-chat-urls";
import type { MeetUnfurlMap } from "@/meet-core/src/meet-types";

const UNFURL: MeetUnfurlMap = {
  "https://docs.example.com/notes/sprint": {
    url: "https://docs.example.com/notes/sprint",
    kind: "internal-docs",
    title: "Sprint notes",
    docsId: "doc-sprint",
  },
  "https://drive.example.com/files/brief": {
    url: "https://drive.example.com/files/brief",
    kind: "internal-file",
    title: "Brief.pdf",
    fileId: "file-brief",
  },
  "https://example.com/blog": {
    url: "https://example.com/blog",
    kind: "external",
    title: "Example blog",
    description: "A fixture OG card",
    siteName: "example.com",
  },
};

describe("chat URL / preview mapping", () => {
  it("normalizes www. URLs and strips trailing punctuation", () => {
    expect(normalizeChatUrl("www.example.com/blog.")).toBe("https://www.example.com/blog");
    expect(normalizeChatUrl("https://docs.example.com/notes/sprint)")).toBe(
      "https://docs.example.com/notes/sprint",
    );
  });

  it("extracts unique normalized URLs from a markdown body", () => {
    expect(
      extractChatUrls(
        "See https://docs.example.com/notes/sprint and www.example.com/blog. Also https://docs.example.com/notes/sprint again.",
      ),
    ).toEqual(["https://docs.example.com/notes/sprint", "https://www.example.com/blog"]);
  });

  it("maps extracted URLs through the fixture unfurl map and skips unknowns", () => {
    expect(
      mapChatPreviews(
        "Docs https://docs.example.com/notes/sprint plus https://unknown.example/x and https://example.com/blog",
        UNFURL,
      ),
    ).toEqual([
      UNFURL["https://docs.example.com/notes/sprint"],
      UNFURL["https://example.com/blog"],
    ]);
  });
});
