/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { RtcSettings } from "@/lib/rtc/types";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { DEFAULT_DOCS_COLLAB_URLS, type DocsCollabTabSyncApi } from "./docs-collab-types";
import {
  encodeSyncStep1,
  encodeUpdateBroadcast,
  handleGuardedSyncMessage,
  SYNC_STEP_1,
} from "./docs-collab-mesh-sync";
import { DEFAULT_DOCS_COLLAB_WIRE, type DocsCollabWireOperations } from "./docs-collab-wire";
import type { DocsRtcSession } from "./docs-rtc-session";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";

const created = vi.hoisted(() => ({ sessions: 0 }));

vi.mock("./docs-rtc-session", () => ({
  DocsRtcSession: class {
    constructor() {
      created.sessions += 1;
    }
    onMessage() {
      return () => undefined;
    }
    async join() {
      return { peerId: "me", peers: [] };
    }
    async leave() {}
    getRoomPeerStatuses() {
      return [];
    }
    getRoomPeers() {
      return [];
    }
    linkCount() {
      return 0;
    }
    getMyName() {
      return "Admin";
    }
  },
}));

/** One transaction, so one Yjs update per call. */
function appendToBody(doc: Y.Doc, text: string): void {
  doc.transact(() => {
    const body = doc.getXmlFragment("default");
    let paragraph = body.get(0) as Y.XmlElement | undefined;
    if (!paragraph) {
      paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText()]);
      body.insert(0, [paragraph]);
    }
    const node = paragraph.get(0) as Y.XmlText;
    node.insert(node.length, text);
  });
}

function bodyText(doc: Y.Doc): string {
  const paragraph = doc.getXmlFragment("default").get(0) as Y.XmlElement | undefined;
  return (paragraph?.get(0) as Y.XmlText | undefined)?.toString() ?? "";
}

/**
 * #1737: a peer in another browser misses one of our updates. Yjs then holds
 * every later update from us as pending, so its text stops partway until a
 * reload. Our next step 1 has to make it pull what it lacks.
 */
describe("useDocsCollabMesh repair after a dropped update", () => {
  it("pulls the missing tail when a peer's step 1 shows more than this doc holds", () => {
    const writer = new Y.Doc();
    const sent: Uint8Array[] = [];
    writer.on("update", (update: Uint8Array) => sent.push(update));
    appendToBody(writer, "Typed quickly");
    appendToBody(writer, " at the end");

    const { result } = renderHook(() => {
      const refs = useDocsCollabSessionRefs(DEFAULT_DOCS_COLLAB_WIRE, undefined);
      const mesh = useDocsCollabMesh({
        refs,
        room: "notes/shared",
        urls: { ...DEFAULT_DOCS_COLLAB_URLS, room: "notes/shared" },
        markDocReady: () => undefined,
        trySeedFromFile: () => undefined,
      });
      return { refs, mesh };
    });
    const { refs, mesh } = result.current;
    const reader = new Y.Doc();
    refs.ydocRef.current = reader;
    refs.awarenessRef.current = new awarenessProtocol.Awareness(reader);
    refs.seedDoneRef.current = true;
    const sendTo = vi.fn();
    refs.meshRef.current = {
      sendTo,
      broadcast: vi.fn(),
      getRoomPeerStatuses: () => [],
      linkCount: () => 1,
      getMyName: () => "Member",
    } as unknown as DocsRtcSession;

    const fromWriter = { from: "peer-admin", trust: { user: "admin", access: "write" as const } };
    // The first update arrives, the second is lost on the way.
    act(() =>
      mesh.handleMeshMessage({ type: "sync", u: encodeUpdateBroadcast(sent[0]!), ...fromWriter }),
    );
    expect(bodyText(reader)).toBe("Typed quickly");

    act(() => mesh.handleMeshMessage({ type: "sync", u: encodeSyncStep1(writer), ...fromWriter }));

    const pull = sendTo.mock.calls
      .filter(([to]) => to === "peer-admin")
      .map(([, message]) => (message as { u: Uint8Array }).u)
      .find((bytes) => bytes[0] === SYNC_STEP_1);
    expect(pull).toBeDefined();
    const answer = handleGuardedSyncMessage({
      bytes: pull!,
      ydoc: writer,
      trust: { user: "member", access: "write" },
    });
    expect(answer.kind).toBe("reply");
    if (answer.kind !== "reply") return;
    act(() => mesh.handleMeshMessage({ type: "sync", u: answer.reply.u, ...fromWriter }));

    expect(bodyText(reader)).toBe("Typed quickly at the end");
  });
});

/**
 * A tab can lose the mesh to another tab while its own join still waits for
 * the RTC settings. Joining anyway gives a follower tab a mesh session of its
 * own: the leader's peer is dropped from the room and nothing reaches the
 * other tabs.
 */
describe("useDocsCollabMesh joinMesh", () => {
  it("does not create a session after this tab stopped leading the mesh", async () => {
    let releaseSettings: ((settings: RtcSettings) => void) | null = null;
    const wire: DocsCollabWireOperations = {
      ...DEFAULT_DOCS_COLLAB_WIRE,
      fetchRtcSettings: () =>
        new Promise<RtcSettings>((resolve) => {
          releaseSettings = resolve;
        }),
    };
    const { result } = renderHook(() => {
      const refs = useDocsCollabSessionRefs(wire, undefined);
      const mesh = useDocsCollabMesh({
        refs,
        room: "docs/claim-race.md",
        urls: { ...DEFAULT_DOCS_COLLAB_URLS, room: "docs/claim-race.md" },
        markDocReady: () => undefined,
        trySeedFromFile: () => undefined,
      });
      return { refs, mesh };
    });
    const { refs, mesh } = result.current;
    const doc = new Y.Doc();
    refs.ydocRef.current = doc;
    refs.awarenessRef.current = new awarenessProtocol.Awareness(doc);
    let leader = true;
    refs.tabSyncRef.current = {
      isMeshLeader: () => leader,
    } as unknown as DocsCollabTabSyncApi;

    const joining = mesh.joinMesh("Admin", "token", () => true);
    await vi.waitFor(() => expect(releaseSettings).not.toBeNull());
    leader = false;
    releaseSettings!({ ...DEFAULT_RTC_SETTINGS });

    await expect(joining).resolves.toBeNull();
    expect(created.sessions).toBe(0);
    expect(refs.meshRef.current).toBeNull();
  });
});
