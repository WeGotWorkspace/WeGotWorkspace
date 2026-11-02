import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  adoptServerSnapshot,
  decideServerStateAdoption,
  loadBootstrapInParallel,
  SNAPSHOT_RETRY_DELAYS_MS,
} from "./docs-collab-bootstrap";

function docWithText(text: string): Y.Doc {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  const node = new Y.XmlElement("paragraph");
  node.insert(0, [new Y.XmlText(text)]);
  fragment.insert(0, [node]);
  return ydoc;
}

function appendParagraph(ydoc: Y.Doc, text: string): void {
  const fragment = ydoc.getXmlFragment("default");
  const node = new Y.XmlElement("paragraph");
  node.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [node]);
}

function stateVector(ydoc: Y.Doc): Map<number, number> {
  return Y.decodeStateVector(Y.encodeStateVector(ydoc));
}

function fragmentText(ydoc: Y.Doc): string {
  return ydoc.getXmlFragment("default").toString();
}

const deferred = () => Promise.resolve();

describe("loadBootstrapInParallel", () => {
  it("loads markdown and the snapshot at the same time", async () => {
    const order: string[] = [];
    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => {
        order.push("markdown:start");
        await deferred();
        order.push("markdown:end");
        return "# Doc";
      },
      fetchSnapshot: async () => {
        order.push("snapshot:start");
        await deferred();
        order.push("snapshot:end");
        return { update: null, etag: null };
      },
      sleep: deferred,
    });

    // Sequential loading would read markdown:end before snapshot:start.
    expect(order.indexOf("snapshot:start")).toBeLessThan(order.indexOf("markdown:end"));
    expect(load.markdown).toBe("# Doc");
  });

  it("reports an absent sidecar for a 204", async () => {
    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot: async () => ({ update: null, etag: null }),
      sleep: deferred,
    });

    expect(load.snapshot).toEqual({ kind: "absent" });
  });

  it("reports the snapshot and its ETag when one exists", async () => {
    const update = Y.encodeStateAsUpdate(docWithText("server"));
    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot: async () => ({ update, etag: '"sidecar-rev-1"' }),
      sleep: deferred,
    });

    expect(load.snapshot).toEqual({
      kind: "snapshot",
      update,
      etag: '"sidecar-rev-1"',
      externalWrite: false,
    });
  });

  // C7: a 5xx or a token race must never be read as "there is no snapshot",
  // because the caller would then seed a second copy of the markdown.
  it("retries a failing snapshot with backoff and never reports it absent", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetchSnapshot = vi.fn(async () => {
      throw new Error("Could not load snapshot (500)");
    });

    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot,
      sleep,
    });

    expect(load.snapshot.kind).toBe("failed");
    expect(fetchSnapshot).toHaveBeenCalledTimes(SNAPSHOT_RETRY_DELAYS_MS.length + 1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([...SNAPSHOT_RETRY_DELAYS_MS]);
  });

  // The room-level backoff has to engage on the first failure. Waiting for the
  // retries to run out let a quick remount start a second round of requests.
  it("reports every failed attempt as it happens", async () => {
    const onAttemptFailed = vi.fn();

    await loadBootstrapInParallel({
      loadMarkdown: async () => {
        throw new Error("Could not load document (500)");
      },
      fetchSnapshot: async () => {
        throw new Error("Could not load snapshot (500)");
      },
      sleep: deferred,
      onAttemptFailed,
    });

    // One markdown failure plus every snapshot attempt.
    expect(onAttemptFailed).toHaveBeenCalledTimes(SNAPSHOT_RETRY_DELAYS_MS.length + 2);
  });

  it("abandons the retries once the join is no longer current", async () => {
    const fetchSnapshot = vi.fn(async () => {
      throw new Error("Could not load snapshot (500)");
    });

    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot,
      sleep: deferred,
      isCurrent: () => false,
      onAttemptFailed: () => undefined,
    });

    expect(load.snapshot.kind).toBe("failed");
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("stops retrying a snapshot as soon as the document is gone", async () => {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetchSnapshot = vi.fn(async () => {
      throw Object.assign(new Error("Could not load snapshot (404)"), { status: 404 });
    });

    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot,
      sleep,
    });

    expect(load.snapshot.kind).toBe("failed");
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops retrying as soon as the snapshot loads", async () => {
    const update = Y.encodeStateAsUpdate(docWithText("server"));
    let attempts = 0;
    const fetchSnapshot = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("Could not load snapshot (503)");
      return { update, etag: null };
    });

    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot,
      sleep: deferred,
    });

    expect(load.snapshot.kind).toBe("snapshot");
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("surfaces a markdown failure without failing the snapshot", async () => {
    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => {
        throw new Error("Could not load document (500)");
      },
      fetchSnapshot: async () => ({ update: null, etag: null }),
      sleep: deferred,
    });

    expect(load.markdown).toBe("");
    expect(load.markdownError).toBeInstanceOf(Error);
    expect(load.snapshot).toEqual({ kind: "absent" });
  });

  it("skips the snapshot entirely when the room has no sidecar endpoint", async () => {
    const load = await loadBootstrapInParallel({
      loadMarkdown: async () => "# Doc",
      fetchSnapshot: null,
      sleep: deferred,
    });

    expect(load.snapshot).toEqual({ kind: "skipped" });
  });
});

describe("decideServerStateAdoption", () => {
  it("discards local IndexedDB state when the server has a snapshot and nothing is pending", () => {
    expect(decideServerStateAdoption({ hasServerSnapshot: true, pendingServerSave: false })).toBe(
      "adopt-server",
    );
  });

  it("merges instead of discarding when a local save is still pending", () => {
    expect(decideServerStateAdoption({ hasServerSnapshot: true, pendingServerSave: true })).toBe(
      "merge",
    );
  });

  it("does nothing when the server has no snapshot", () => {
    expect(decideServerStateAdoption({ hasServerSnapshot: false, pendingServerSave: false })).toBe(
      "none",
    );
    expect(decideServerStateAdoption({ hasServerSnapshot: false, pendingServerSave: true })).toBe(
      "none",
    );
  });
});

describe("adoptServerSnapshot", () => {
  it("reopens with the same history and keeps content (IndexedDB == server)", () => {
    const serverDoc = docWithText("shared paragraph");
    const serverUpdate = Y.encodeStateAsUpdate(serverDoc);
    const local = new Y.Doc();
    Y.applyUpdate(local, serverUpdate);

    adoptServerSnapshot(local, serverUpdate, "server");

    expect(fragmentText(local)).toContain("shared paragraph");
  });

  it("updates local IndexedDB when the server snapshot is ahead", () => {
    const local = docWithText("old copy");
    const serverDoc = docWithText("newer server copy");
    const serverUpdate = Y.encodeStateAsUpdate(serverDoc);

    adoptServerSnapshot(local, serverUpdate, "server");

    const text = fragmentText(local);
    expect(text).toContain("newer server copy");
    expect(text).not.toContain("old copy");
  });

  it("loads the server snapshot into a fresh document", () => {
    const empty = new Y.Doc();
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(empty, serverUpdate, "server");

    expect(fragmentText(empty)).toContain("server copy");
  });

  it("replaces an earlier local seed instead of merging it", () => {
    const local = docWithText("local seed");
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(local, serverUpdate, "server");

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).not.toContain("local seed");
  });

  it("drops a stale local seed when the server snapshot has other content too", () => {
    const local = docWithText("local seed");
    const serverDoc = docWithText("server copy");
    const extra = new Y.XmlElement("paragraph");
    extra.insert(0, [new Y.XmlText("extra server line")]);
    serverDoc.getXmlFragment("default").insert(1, [extra]);
    const serverUpdate = Y.encodeStateAsUpdate(serverDoc);

    adoptServerSnapshot(local, serverUpdate, "server");

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).toContain("extra server line");
    expect(text).not.toContain("local seed");
  });

  it("keeps text typed after the local copy loaded and drops the stale seed", () => {
    const stored = docWithText("local seed");
    const local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(stored));
    const loaded = stateVector(local);
    appendParagraph(local, "typed after load");
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(local, serverUpdate, "server", loaded);

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).toContain("typed after load");
    expect(text).not.toContain("local seed");
  });

  it("keeps later edits by the same client that wrote the stale seed", () => {
    const local = docWithText("local seed");
    const loaded = stateVector(local);
    appendParagraph(local, "typed after load");
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(local, serverUpdate, "server", loaded);

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).toContain("typed after load");
    expect(text).not.toContain("local seed");
  });

  /** Another tab typed into the shared local copy; its save has not reached the server yet. */
  function localCopyAheadOfServer(server: Y.Doc, edit: (other: Y.Doc) => void): Y.Doc {
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(server));
    edit(other);
    const local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(other));
    other.destroy();
    return local;
  }

  /** The join bootstrap: the local copy loaded from IndexedDB, then the snapshot arrived. */
  function adoptOnJoin(local: Y.Doc, server: Y.Doc, loaded: Map<number, number>): boolean {
    return adoptServerSnapshot(local, Y.encodeStateAsUpdate(server), "server", loaded, {
      keepUnsavedEdits: true,
    });
  }

  it("keeps another tab's unsaved text that is in the local copy but not yet on the server (#1722)", () => {
    const server = docWithText("Saved line");
    const local = localCopyAheadOfServer(server, (other) => {
      const paragraph = other.getXmlFragment("default").get(0) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(10, " typed just now");
      appendParagraph(other, "a new paragraph");
    });

    const dropped = adoptOnJoin(local, server, stateVector(local));

    const text = fragmentText(local);
    expect(text).toContain("Saved line typed just now");
    expect(text).toContain("a new paragraph");
    expect(dropped).toBe(false);
  });

  it("keeps unsaved text typed at the start of the document and inside a new paragraph", () => {
    const server = docWithText("Saved line");
    const local = localCopyAheadOfServer(server, (other) => {
      const fragment = other.getXmlFragment("default");
      const node = new Y.XmlElement("paragraph");
      const typed = new Y.XmlText("first");
      node.insert(0, [typed]);
      fragment.insert(0, [node]);
      typed.insert(5, " and more");
    });

    adoptOnJoin(local, server, stateVector(local));

    const text = fragmentText(local);
    expect(text).toContain("first and more");
    expect(text).toContain("Saved line");
  });

  it("keeps unsaved text built on another unsaved edit", () => {
    const server = docWithText("Saved line");
    const first = localCopyAheadOfServer(server, (other) => appendParagraph(other, "tab one"));
    const local = localCopyAheadOfServer(first, (other) => {
      const fragment = other.getXmlFragment("default");
      const paragraph = fragment.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(7, ", then tab two");
    });
    first.destroy();

    adoptOnJoin(local, server, stateVector(local));

    expect(fragmentText(local)).toContain("tab one, then tab two");
  });

  it("keeps a new comment or a first title that is not on the server yet", () => {
    const server = docWithText("Saved line");
    const local = localCopyAheadOfServer(server, (other) => {
      other.getMap("comments").set("thread-1", "unsaved comment");
      other.getText("title").insert(0, "First title");
    });

    adoptOnJoin(local, server, stateVector(local));

    expect(local.getMap("comments").get("thread-1")).toBe("unsaved comment");
    expect(local.getText("title").toString()).toBe("First title");
  });

  it("drops a stale local seed that a later merge put next to the server state", () => {
    // An offline pin seeded the text before the sidecar existed, and a later
    // refresh merged the server state into the same local copy.
    const local = docWithText("local seed");
    const server = docWithText("server copy");
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
    const loaded = stateVector(local);

    const dropped = adoptOnJoin(local, server, loaded);

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).not.toContain("local seed");
    expect(dropped).toBe(true);
  });

  it("drops a stale seeded title when the server has its own title", () => {
    const local = docWithText("local seed");
    local.getText("title").insert(0, "Old title");
    const server = docWithText("server copy");
    server.getText("title").insert(0, "Server title");

    adoptOnJoin(local, server, stateVector(local));

    expect(local.getText("title").toString()).toBe("Server title");
  });

  it("replaces everything the server lacks when no loaded state is given (outside rewrite)", () => {
    const server = docWithText("Saved line");
    const local = localCopyAheadOfServer(server, (other) => appendParagraph(other, "unsaved"));
    const rebuilt = docWithText("uploaded text");

    adoptServerSnapshot(local, Y.encodeStateAsUpdate(rebuilt), "server");

    const text = fragmentText(local);
    expect(text).toContain("uploaded text");
    expect(text).not.toContain("unsaved");
  });

  it("deletes all of the given history without keepUnsavedEdits (rebuild over a stale sidecar)", () => {
    const stale = docWithText("old text");
    stale.getMap("comments").set("thread-1", "old comment");
    stale.getText("title").insert(0, "Old title");
    const local = new Y.Doc();
    Y.applyUpdate(local, Y.encodeStateAsUpdate(stale));
    const rebuilt = docWithText("uploaded text");

    adoptServerSnapshot(local, Y.encodeStateAsUpdate(rebuilt), "server", stateVector(stale));

    expect(fragmentText(local)).toContain("uploaded text");
    expect(fragmentText(local)).not.toContain("old text");
    expect(local.getMap("comments").get("thread-1")).toBeUndefined();
    expect(local.getText("title").toString()).toBe("");
  });

  it("reports whether it dropped local state", () => {
    const serverDoc = docWithText("shared paragraph");
    const serverUpdate = Y.encodeStateAsUpdate(serverDoc);

    const same = new Y.Doc();
    Y.applyUpdate(same, serverUpdate);
    expect(adoptServerSnapshot(same, serverUpdate, "server", stateVector(same))).toBe(false);

    const stale = docWithText("local seed");
    expect(adoptServerSnapshot(stale, serverUpdate, "server", stateVector(stale))).toBe(true);

    const edited = new Y.Doc();
    Y.applyUpdate(edited, serverUpdate);
    const loaded = stateVector(edited);
    appendParagraph(edited, "typed after load");
    expect(adoptServerSnapshot(edited, serverUpdate, "server", loaded)).toBe(false);
  });
});
