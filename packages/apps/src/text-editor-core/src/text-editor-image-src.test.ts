import { describe, expect, it } from "vitest";
import {
  docsImageMarkdown,
  isFileNodeId,
  parseDriveFnSrc,
  serializeDocsImageSrc,
  splitImageFragment,
  toDriveFnSrc,
} from "./text-editor-image-src";

const NODE_ID = "fn-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("docs image src protocol", () => {
  it("round-trips FileNode ids to drive:fn- srcs", () => {
    expect(isFileNodeId(NODE_ID)).toBe(true);
    expect(toDriveFnSrc(NODE_ID)).toBe(`drive:${NODE_ID}`);
    expect(parseDriveFnSrc(`drive:${NODE_ID}`)).toBe(NODE_ID);
    expect(parseDriveFnSrc("https://example.com/photo.png")).toBeNull();
  });

  it("serializes persistable srcs and drops embedded bytes", () => {
    expect(serializeDocsImageSrc(`drive:${NODE_ID}`)).toBe(`drive:${NODE_ID}`);
    expect(serializeDocsImageSrc("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(serializeDocsImageSrc("blob:https://app/uuid")).toBeNull();
    expect(serializeDocsImageSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(docsImageMarkdown("Cat", `drive:${NODE_ID}`)).toBe(`![Cat](drive:${NODE_ID})`);
  });

  it("leaves fragments it does not own untouched", () => {
    for (const url of ["https://x.test/sprite.svg#icon", "https://x.test/a.png#xywh=1,2,3,4"]) {
      expect(splitImageFragment(url)).toEqual({ src: url, width: null, align: null });
      expect(docsImageMarkdown("A", url)).toBe(`![A](${url})`);
    }
    expect(splitImageFragment(`drive:${NODE_ID}#width=50&icon`)).toMatchObject({ width: 50 });
  });

  it("keeps a foreign fragment byte for byte when width is set and read back", () => {
    for (const url of ["https://x.test/sprite.svg#icon", "https://x.test/a.png#xywh=1,2,3,4"]) {
      const md = docsImageMarkdown("A", url, { width: 50 });
      expect(md).toBe(`![A](${url}&width=50)`);
      expect(splitImageFragment(`${url}&width=50`)).toEqual({ src: url, width: 50, align: null });
    }
    expect(splitImageFragment(`drive:${NODE_ID}#width=50&icon`)).toEqual({
      src: `drive:${NODE_ID}#icon`,
      width: 50,
      align: null,
    });
  });
});
