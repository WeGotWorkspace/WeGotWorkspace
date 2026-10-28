/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { RtcSettings } from "@/lib/rtc/types";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { DEFAULT_DOCS_COLLAB_URLS, type DocsCollabTabSyncApi } from "./docs-collab-types";
import { DEFAULT_DOCS_COLLAB_WIRE, type DocsCollabWireOperations } from "./docs-collab-wire";
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
