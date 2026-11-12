/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { hydrateDocsCollabForOffline } from "@/lib/offline/docs/docs-pin-hydrate";
import { recordDocsNodePath } from "@/lib/offline/docs/docs-node-paths";
import {
  DOCS_COLLAB_IDENTITY_DB_VERSION,
  DOCS_COLLAB_PATH_DB_VERSION,
  docsCollabIndexedDbKey,
} from "./docs-collab-persistence";
import { docsCollabPathDbLockName } from "./docs-collab-path-db-lock";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";
import { DEFAULT_DOCS_COLLAB_URLS } from "./docs-collab-types";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";
import { useDocsCollabJoin } from "./use-docs-collab-join";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";

// The race does not need a network: the editor and the hydration both work offline.
vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  getConnectivitySnapshot: () => false,
}));

const USER = "alice";

let counter = 0;
/** A new Doc path and the server id it gets on reconnect. */
function nextDoc(): { room: string; nodeId: string } {
  counter += 1;
  return { room: `users/${USER}/race-1933-${counter}.md`, nodeId: `fn-1933-${counter}` };
}

/** The editor's join, as Docs mounts it, without mesh or server traffic. */
function useEditor(room: string) {
  const refs = useDocsCollabSessionRefs(DEFAULT_DOCS_COLLAB_WIRE, undefined);
  const urls = { ...DEFAULT_DOCS_COLLAB_URLS, room };
  const mesh = useDocsCollabMesh({
    refs,
    room,
    urls,
    markDocReady: () => undefined,
    trySeedFromFile: () => undefined,
    setDocStatus: () => undefined,
  });
  const join = useDocsCollabJoin({
    refs,
    room,
    urls,
    userName: "Ada",
    mesh,
    save: { updatePendingState: async () => undefined, flushPendingSaveIfReady: () => undefined },
    setDocStatus: () => undefined,
    setLastSavedAt: () => undefined,
    setPendingSync: () => undefined,
    setFailedSync: () => undefined,
  });
  // As `useDocsCollab` does: leaving the Doc tears the session down.
  const teardownRef = useRef(join.teardown);
  teardownRef.current = join.teardown;
  useEffect(
    () => () => {
      refs.joinGenerationRef.current += 1;
      teardownRef.current();
    },
    [refs],
  );
  return { refs, join: join.join };
}

async function openEditor(room: string) {
  const editor = renderHook(() => useEditor(room));
  await act(async () => {
    await editor.result.current.join();
  });
  const { ydocRef, persistenceRef } = editor.result.current.refs;
  const ydoc = ydocRef.current;
  const persistence = persistenceRef.current;
  if (!ydoc || !persistence) throw new Error("editor did not join");
  return { editor, ydoc, databaseName: persistence.name };
}

/** Types at the end of the first paragraph, as a keystroke would. */
function type(doc: Y.Doc, text: string): void {
  const xml = doc.getXmlFragment("default");
  let paragraph = xml.get(0);
  if (!(paragraph instanceof Y.XmlElement)) {
    paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText()]);
    xml.insert(0, [paragraph]);
  }
  const node = (paragraph as Y.XmlElement).get(0) as Y.XmlText;
  try {
    node.insert(node.length, text);
  } catch {
    // A store closed under the editor throws from y-indexeddb's update handler;
    // the text is still in memory, which is the bug this file covers.
  }
}

function bodyText(doc: Y.Doc): string {
  const paragraph = doc.getXmlFragment("default").get(0);
  if (!(paragraph instanceof Y.XmlElement)) return "";
  const node = paragraph.get(0);
  return node instanceof Y.XmlText ? node.toString() : "";
}

/** y-indexeddb writes each update in its own transaction; let them land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function readDatabase(name: string): Promise<{ text: string; pending: boolean }> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, ydoc);
  try {
    await persistence.whenSynced;
    return {
      text: bodyText(ydoc),
      pending: Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY)),
    };
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

type Mode = "shared" | "exclusive";

/** Web Locks with shared and exclusive modes, enough for one origin in a test. */
function installWebLocks(): void {
  const held = new Map<string, { mode: Mode; count: number }>();
  const waiting = new Map<string, Array<() => void>>();
  const free = (name: string, mode: Mode) => {
    const current = held.get(name);
    return !current || (mode === "shared" && current.mode === "shared");
  };
  const locks = {
    async request(
      name: string,
      options: { mode?: Mode; ifAvailable?: boolean },
      callback: (lock: object | null) => Promise<unknown> | unknown,
    ) {
      const mode = options.mode ?? "exclusive";
      if (!free(name, mode)) {
        if (options.ifAvailable) return callback(null);
        while (!free(name, mode)) {
          await new Promise<void>((resolve) =>
            waiting.set(name, [...(waiting.get(name) ?? []), resolve]),
          );
        }
      }
      const current = held.get(name);
      held.set(name, { mode, count: (current?.count ?? 0) + 1 });
      try {
        return await callback({ name, mode });
      } finally {
        const after = held.get(name);
        if (after && after.count > 1) held.set(name, { ...after, count: after.count - 1 });
        else held.delete(name);
        const queue = waiting.get(name) ?? [];
        waiting.delete(name);
        for (const wake of queue) wake();
      }
    },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
}

/** Another tab's editor holds the path-keyed copy until the returned release runs. */
function holdInAnotherTab(room: string): () => void {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void navigator.locks.request(docsCollabPathDbLockName(room), { mode: "shared" }, () => held);
  return release;
}

beforeEach(() => {
  installWebLocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  vi.restoreAllMocks();
});

describe("Doc opened by path while background hydration learns its id (#1933)", () => {
  async function typeAcrossHydration({ room, nodeId }: { room: string; nodeId: string }) {
    const { editor, ydoc, databaseName } = await openEditor(room);
    expect(databaseName).toBe(docsCollabIndexedDbKey(room, DOCS_COLLAB_PATH_DB_VERSION));
    type(ydoc, "Typed offline.");
    await settle();

    // Reconnect: the server id becomes known and background hydration runs.
    await recordDocsNodePath(USER, nodeId, room);
    await hydrateDocsCollabForOffline({ apiPath: room }).catch(() => undefined);

    type(ydoc, " Typed after reconnect.");
    await settle();
    editor.unmount();
    await settle();
  }

  it("keeps text typed after the hydration when the Doc reopens by id", async () => {
    const doc = nextDoc();
    await typeAcrossHydration(doc);

    const reopened = await openEditor(doc.room);
    expect(reopened.databaseName).toBe(
      docsCollabIndexedDbKey(doc.nodeId, DOCS_COLLAB_IDENTITY_DB_VERSION),
    );
    expect(bodyText(reopened.ydoc)).toBe("Typed offline. Typed after reconnect.");
    reopened.editor.unmount();
    await settle();
  });

  it("keeps it in a browser without Web Locks too (same tab)", async () => {
    Reflect.deleteProperty(navigator, "locks");
    const doc = nextDoc();
    await typeAcrossHydration(doc);

    const reopened = await openEditor(doc.room);
    expect(bodyText(reopened.ydoc)).toBe("Typed offline. Typed after reconnect.");
    reopened.editor.unmount();
    await settle();
  });

  it("leaves the path-keyed copy alone while another tab's editor has it open", async () => {
    const { room, nodeId } = nextDoc();
    const pathDb = docsCollabIndexedDbKey(room, DOCS_COLLAB_PATH_DB_VERSION);
    const { editor, ydoc } = await openEditor(room);
    type(ydoc, "Typed in tab A.");
    await settle();
    editor.unmount();
    await settle();

    const releaseOtherTab = holdInAnotherTab(room);
    await recordDocsNodePath(USER, nodeId, room);
    await hydrateDocsCollabForOffline({ apiPath: room }).catch(() => undefined);
    expect((await readDatabase(pathDb)).text).toBe("Typed in tab A.");

    // A second editor opened by id does not take the copy from under tab A either.
    const byId = await openEditor(room);
    expect((await readDatabase(pathDb)).text).toBe("Typed in tab A.");
    byId.editor.unmount();
    await settle();

    // Once tab A lets go, the next open by id moves the text over.
    releaseOtherTab();
    await settle();
    const reopened = await openEditor(room);
    expect(bodyText(reopened.ydoc)).toBe("Typed in tab A.");
    reopened.editor.unmount();
    await settle();
  });
});
