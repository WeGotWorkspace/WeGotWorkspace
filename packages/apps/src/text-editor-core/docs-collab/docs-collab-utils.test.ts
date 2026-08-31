import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  colorForName,
  collabDocumentFormat,
  docSignature,
  IDB_ORIGIN,
  isCollabPayloadTooLarge,
  isCollabPreconditionFailed,
  isRemoteUpdateOrigin,
  isYDocEmpty,
  MESH_ORIGIN,
  SERVER_ORIGIN,
} from "./docs-collab-utils";

describe("docs-collab-utils", () => {
  it("colorForName is stable for the same input", () => {
    expect(colorForName("Alex")).toBe(colorForName("Alex"));
    expect(colorForName("Alex")).not.toBe(colorForName("Bob"));
  });

  it("treats 412 as a join abort, not an empty-seed load failure", () => {
    expect(isCollabPreconditionFailed(new Error("precondition failed (412)"))).toBe(true);
    expect(isCollabPreconditionFailed(Object.assign(new Error("stale"), { status: 412 }))).toBe(
      true,
    );
    expect(isCollabPreconditionFailed(new Error("network"))).toBe(false);
  });

  it("treats 413 as a permanent save failure", () => {
    expect(isCollabPayloadTooLarge(Object.assign(new Error("PATCH failed (413)"), { status: 413 }))).toBe(
      true,
    );
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
