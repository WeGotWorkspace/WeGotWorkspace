import { describe, expect, it } from "vitest";
import {
  docsImageMarkdown,
  isFileNodeId,
  parseDriveFnSrc,
  serializeDocsImageSrc,
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
});
