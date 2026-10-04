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

    expect(load.snapshot).toEqual({ kind: "snapshot", update, etag: '"sidecar-rev-1"' });
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
  it("replaces an earlier local seed instead of merging it", () => {
    const local = docWithText("local seed");
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(local, serverUpdate, "server");

    const text = fragmentText(local);
    expect(text).toContain("server copy");
    expect(text).not.toContain("local seed");
  });

  it("is a no-op on an empty document beyond applying the server state", () => {
    const empty = new Y.Doc();
    const serverUpdate = Y.encodeStateAsUpdate(docWithText("server copy"));

    adoptServerSnapshot(empty, serverUpdate, "server");

    expect(fragmentText(empty)).toContain("server copy");
  });
});
