import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyGuardedRemoteUpdate } from "./docs-collab-update-guard";
import { DOCS_COMMENTS_MAP_KEY } from "./docs-comments-types";
import { DOCS_SUGGESTION_THREADS_MAP_KEY } from "./docs-suggestions-types";

const MESH = "mesh";

function author(id: string): { id: string; name: string } {
  return { id, name: id };
}

function message(id: string, authorId: string, body = "body") {
  return { id, body, createdAt: "2026-01-01T00:00:00.000Z", author: author(authorId) };
}

function thread(id: string, ownerId: string, messages: ReturnType<typeof message>[]) {
  return {
    id,
    anchorText: "anchor",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: author(ownerId),
    resolved: false,
    messages,
  };
}

/** A document both sides already agree on, plus a detached peer replica. */
function pair(seed?: (doc: Y.Doc) => void): { local: Y.Doc; remote: Y.Doc } {
  const local = new Y.Doc();
  local.getXmlFragment("default");
  local.getMap(DOCS_COMMENTS_MAP_KEY);
  local.getMap(DOCS_SUGGESTION_THREADS_MAP_KEY);
  seed?.(local);

  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
  return { local, remote };
}

function diff(local: Y.Doc, remote: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(remote, Y.encodeStateVector(local));
}

function typeBody(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment("default");
  const paragraph = new Y.XmlElement("paragraph");
  const node = new Y.XmlText();
  node.insert(0, text);
  paragraph.insert(0, [node]);
  fragment.insert(fragment.length, [paragraph]);
}

function bodyText(doc: Y.Doc): string {
  return doc.getXmlFragment("default").toJSON();
}

function guard(local: Y.Doc, remote: Y.Doc, access: "read" | "comment" | "write", user: string) {
  return applyGuardedRemoteUpdate({
    doc: local,
    update: diff(local, remote),
    access,
    senderUser: user,
    origin: MESH,
  });
}

describe("docs-collab-update-guard", () => {
  it("drops every update from a reader", () => {
    const { local, remote } = pair();
    typeBody(remote, "viewer text");

    expect(guard(local, remote, "read", "carol")).toEqual({ applied: false, reason: "reader" });
    expect(bodyText(local)).toBe("");
  });

  it("drops a reader's comment too — read means read", () => {
    const { local, remote } = pair();
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "carol", [message("m1", "carol")]));

    expect(guard(local, remote, "read", "carol").applied).toBe(false);
    expect(local.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(0);
  });

  it("applies an editor's body edit", () => {
    const { local, remote } = pair();
    typeBody(remote, "editor text");

    expect(guard(local, remote, "write", "bob")).toEqual({ applied: true });
    expect(bodyText(local)).toContain("editor text");
  });

  it("drops a commenter's body edit", () => {
    const { local, remote } = pair();
    typeBody(remote, "commenter text");

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "body-edit-by-commenter",
    });
    expect(bodyText(local)).toBe("");
  });

  it("applies a commenter adding a thread of their own", () => {
    const { local, remote } = pair();
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "carol", [message("m1", "carol")]));

    expect(guard(local, remote, "comment", "carol")).toEqual({ applied: true });
    expect(local.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(1);
  });

  it("applies a commenter replying on a suggestion thread", () => {
    const { local, remote } = pair();
    remote
      .getMap(DOCS_SUGGESTION_THREADS_MAP_KEY)
      .set("c1", { changeId: "c1", messages: [message("m1", "carol", "looks good")] });

    expect(guard(local, remote, "comment", "carol")).toEqual({ applied: true });
    expect(local.getMap(DOCS_SUGGESTION_THREADS_MAP_KEY).size).toBe(1);
  });

  it("applies a commenter replying inside somebody else's thread", () => {
    const { local, remote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m1", "bob")]));
    });
    remote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", thread("t1", "bob", [message("m1", "bob"), message("m2", "carol")]));

    expect(guard(local, remote, "comment", "carol")).toEqual({ applied: true });
  });

  it("drops a comment the sender attributes to somebody else", () => {
    const { local, remote } = pair();
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m1", "bob")]));

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "foreign-authorship",
    });
    expect(local.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(0);
  });

  it("drops a commenter rewriting a message somebody else wrote", () => {
    const { local, remote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m1", "bob")]));
    });
    remote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", thread("t1", "bob", [message("m1", "bob", "tampered")]));

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "foreign-entry-change",
    });
  });

  it("drops a commenter deleting a message somebody else wrote", () => {
    const { local, remote } = pair((doc) => {
      doc
        .getMap(DOCS_COMMENTS_MAP_KEY)
        .set("t1", thread("t1", "bob", [message("m1", "bob"), message("m2", "carol")]));
    });
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m2", "carol")]));

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "foreign-entry-change",
    });
  });

  it("drops a commenter resolving a thread — resolve stays an editor right", () => {
    const { local, remote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m1", "bob")]));
    });
    remote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", { ...thread("t1", "bob", [message("m1", "bob")]), resolved: true });

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "resolve-by-commenter",
    });
    expect(local.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(1);
  });

  it("lets an editor resolve and delete", () => {
    const { local, remote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "carol", [message("m1", "carol")]));
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t2", thread("t2", "carol", [message("m2", "carol")]));
    });
    remote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", { ...thread("t1", "carol", [message("m1", "carol")]), resolved: true });
    remote.getMap(DOCS_COMMENTS_MAP_KEY).delete("t2");

    expect(guard(local, remote, "write", "bob")).toEqual({ applied: true });
    expect(local.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(1);
  });

  it("drops an editor's comment attributed to somebody else and keeps the map intact", () => {
    const { local, remote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "bob", [message("m1", "bob")]));
    });
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t2", thread("t2", "carol", [message("m2", "carol")]));

    expect(guard(local, remote, "write", "bob")).toEqual({
      applied: false,
      reason: "foreign-authorship",
    });
    expect([...local.getMap(DOCS_COMMENTS_MAP_KEY).keys()]).toEqual(["t1"]);
  });

  it("allows a reaction keyed by the sender's own id and refuses one keyed by another", () => {
    const base = thread("t1", "bob", [message("m1", "bob")]);
    const { local: ownLocal, remote: ownRemote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", base);
    });
    ownRemote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", { ...base, reactions: [{ emoji: "👍", userIds: ["carol"] }] });
    expect(guard(ownLocal, ownRemote, "comment", "carol")).toEqual({ applied: true });

    const { local: foreignLocal, remote: foreignRemote } = pair((doc) => {
      doc.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", base);
    });
    foreignRemote
      .getMap(DOCS_COMMENTS_MAP_KEY)
      .set("t1", { ...base, reactions: [{ emoji: "👍", userIds: ["dave"] }] });
    expect(guard(foreignLocal, foreignRemote, "comment", "carol")).toEqual({
      applied: false,
      reason: "foreign-authorship",
    });
  });

  it("drops an update from a sender with no verified username", () => {
    const { local, remote } = pair();
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "", [message("m1", "")]));

    expect(guard(local, remote, "comment", "")).toEqual({
      applied: false,
      reason: "foreign-authorship",
    });
  });

  /**
   * The clone is the only expensive step, and it exists for the commenter
   * check alone. On a megabyte of body an editor's keystroke has to stay in
   * the same order of magnitude as a bare `Y.applyUpdate`, so a wide margin is
   * enough to catch the clone creeping into the fast path.
   */
  it("does not clone the document for an editor update on a 1 MB doc", () => {
    const { local, remote } = pair((doc) => {
      doc.getText("bulk").insert(0, "x".repeat(1_100_000));
    });
    expect(Y.encodeStateAsUpdate(local).byteLength).toBeGreaterThan(1_000_000);

    remote.getText("bulk").insert(0, "e");
    const editorUpdate = diff(local, remote);
    const editorStarted = performance.now();
    expect(
      applyGuardedRemoteUpdate({
        doc: local,
        update: editorUpdate,
        access: "write",
        senderUser: "bob",
        origin: MESH,
      }),
    ).toEqual({ applied: true });
    const editorMs = performance.now() - editorStarted;

    const cloneStarted = performance.now();
    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(local));
    const cloneMs = performance.now() - cloneStarted;

    expect(editorMs).toBeLessThan(Math.max(cloneMs, 1));
  });

  it("applies a commenter's own thread while the live doc already has pending", () => {
    const editor = new Y.Doc();
    editor.clientID = 1;
    editor.getXmlFragment("default").insert(0, [new Y.XmlText("hello")]);
    const sv = Y.encodeStateVector(editor);
    editor.getXmlFragment("default").delete(0, 1);
    const victim = new Y.Doc();
    applyGuardedRemoteUpdate({
      doc: victim,
      update: Y.encodeStateAsUpdate(editor, sv),
      access: "write",
      senderUser: "erin",
      origin: "mesh",
    });
    expect(victim.store.pendingDs).not.toBeNull();

    // Carol's update is only her thread. Seeding her replica from the victim
    // would copy victim.store.pendingDs into the update, which is the
    // delete-ahead case covered below — not a legitimate comment.
    const remote = new Y.Doc();
    remote.getMap(DOCS_COMMENTS_MAP_KEY).set("t1", thread("t1", "carol", [message("m1", "carol")]));

    expect(
      applyGuardedRemoteUpdate({
        doc: victim,
        update: diff(victim, remote),
        access: "comment",
        senderUser: "carol",
        origin: "mesh",
      }),
    ).toEqual({ applied: true });
    expect(victim.getMap(DOCS_COMMENTS_MAP_KEY).size).toBe(1);
    expect(victim.store.pendingDs).not.toBeNull();
  });

  it("rejects a commenter delete the receiver has not seen yet", () => {
    const editor = new Y.Doc();
    editor.clientID = 1;
    editor.getXmlFragment("default").insert(0, [new Y.XmlText("secret body")]);
    const editorUpdate = Y.encodeStateAsUpdate(editor);
    const commenter = new Y.Doc();
    commenter.clientID = 2;
    Y.applyUpdate(commenter, editorUpdate);
    const sv = Y.encodeStateVector(commenter);
    commenter.getXmlFragment("default").delete(0, 1);
    const deleteOnly = Y.encodeStateAsUpdate(commenter, sv);
    const victim = new Y.Doc();
    expect(
      applyGuardedRemoteUpdate({
        doc: victim,
        update: deleteOnly,
        access: "comment",
        senderUser: "c",
        origin: "mesh",
      }).applied,
    ).toBe(false);
    Y.applyUpdate(victim, editorUpdate);
    expect(victim.getXmlFragment("default").toString()).toContain("secret body");
  });

  it("treats a root type the commenter invents as a body edit", () => {
    const { local, remote } = pair();
    remote.getMap("smuggled").set("k", "v");

    expect(guard(local, remote, "comment", "carol")).toEqual({
      applied: false,
      reason: "body-edit-by-commenter",
    });
  });
});
