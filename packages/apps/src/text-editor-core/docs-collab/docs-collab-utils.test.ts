import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  colorForName,
  collabDocumentFormat,
  docSignature,
  IDB_ORIGIN,
  isCollabDocumentGoneError,
  isCollabPayloadTooLarge,
  isCollabPreconditionFailed,
  isRemoteUpdateOrigin,
  isServerDivergenceError,
  readableTextColorOn,
  isYDocEmpty,
  MESH_ORIGIN,
  SERVER_ORIGIN,
} from "./docs-collab-utils";

describe("docs-collab-utils", () => {
  it("colorForName is stable for the same input", () => {
    expect(colorForName("Alex")).toBe(colorForName("Alex"));
    expect(colorForName("Alex")).not.toBe(colorForName("Bob"));
  });

  it("picks black or white name-tag text that reaches 4.5:1 on every collaborator color", () => {
    const names = Array.from({ length: 64 }, (_, index) => `User ${index}`);
    for (const background of new Set(names.map(colorForName))) {
      const text = readableTextColorOn(background);
      expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableTextColorOn("#16a34a")).toBe("#000000");
    expect(readableTextColorOn("#2563eb")).toBe("#ffffff");
    expect(readableTextColorOn("#abc")).toBe("#000000");
  });

  it("treats 412 as a join abort, not an empty-seed load failure", () => {
    expect(isCollabPreconditionFailed(new Error("precondition failed (412)"))).toBe(true);
    expect(isCollabPreconditionFailed(Object.assign(new Error("stale"), { status: 412 }))).toBe(
      true,
    );
    expect(isCollabPreconditionFailed(new Error("network"))).toBe(false);
    expect(
      isCollabPreconditionFailed(
        Object.assign(new Error("precondition_required"), { status: 428 }),
      ),
    ).toBe(false);
  });

  it("treats 428 and precondition_required as a server divergence", () => {
    expect(isServerDivergenceError(Object.assign(new Error("stale"), { status: 428 }))).toBe(true);
    expect(isServerDivergenceError(new Error("precondition_required"))).toBe(true);
  });

  it("treats 404 as a gone document", () => {
    expect(isCollabDocumentGoneError(Object.assign(new Error("missing"), { status: 404 }))).toBe(
      true,
    );
    expect(isCollabDocumentGoneError(new Error("GET failed (404)"))).toBe(true);
    expect(isCollabDocumentGoneError(new Error("GET failed (500)"))).toBe(false);
    expect(isServerDivergenceError(new Error("GET failed (404)"))).toBe(false);
  });

  it("treats 413 as a permanent save failure", () => {
    expect(
      isCollabPayloadTooLarge(Object.assign(new Error("PATCH failed (413)"), { status: 413 })),
    ).toBe(true);
    expect(isCollabPayloadTooLarge(new Error("markdown_too_large"))).toBe(true);
    expect(isCollabPayloadTooLarge(new Error("PATCH failed (500)"))).toBe(false);
  });

  it("isYDocEmpty detects empty and non-empty docs", () => {
    const empty = new Y.Doc();
    expect(isYDocEmpty(empty)).toBe(true);

    const xml = empty.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    xml.insert(0, [paragraph]);
    expect(isYDocEmpty(empty)).toBe(false);
  });

  it("collabDocumentFormat derives format from room path", () => {
    expect(collabDocumentFormat("docs/readme.md")).toBe("markdown");
    expect(collabDocumentFormat("docs/readme.txt")).toBe("text");
  });

  it("isRemoteUpdateOrigin recognizes mesh and persistence origins", () => {
    expect(isRemoteUpdateOrigin(MESH_ORIGIN, null)).toBe(true);
    expect(isRemoteUpdateOrigin(SERVER_ORIGIN, null)).toBe(true);
    expect(isRemoteUpdateOrigin(IDB_ORIGIN, null)).toBe(true);
    const persistence = { id: "persistence" };
    expect(isRemoteUpdateOrigin(persistence, persistence as never)).toBe(true);
    expect(isRemoteUpdateOrigin("local-edit", null)).toBe(false);
  });

  it("docSignature is stable for unchanged content", () => {
    const ydoc = new Y.Doc();
    const sig1 = docSignature("# Hello", ydoc);
    const sig2 = docSignature("# Hello", ydoc);
    expect(sig1).toBe(sig2);

    const sig3 = docSignature("# Hello world", ydoc);
    expect(sig3).not.toBe(sig1);
  });
});

function luminance(hex: string): number {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
