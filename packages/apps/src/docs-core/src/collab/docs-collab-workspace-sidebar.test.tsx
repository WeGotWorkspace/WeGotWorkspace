import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { resetConnectivityHubForTests } from "@/lib/offline/core/browser-online";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { resetDocsCollabMeshLingerForTests } from "@/text-editor-core/docs-collab/docs-collab-mesh-linger";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab/docs-collab-types";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";
import { DocsCollabWorkspace } from "./docs-collab-workspace";
import {
  DEFAULT_DOCS_COLLAB_URLS,
  resetDocsCollabBackoffForTests,
} from "@/text-editor-core/docs-collab/use-docs-collab";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/docs" } }),
}));

vi.mock("@/app-switch-button/src/use-show-admin-app", () => ({
  useShowAdminApp: () => false,
}));

vi.mock("@/text-editor-core/docs-collab/docs-rtc-session", () => ({
  DocsRtcSession: class MockDocsRtcSession {
    join = vi.fn(async () => ({ peers: [] }));
    leave = vi.fn();
    broadcast = vi.fn();
    onMessage = vi.fn();
    getPeerIds = vi.fn(() => []);
    getRoomPeers = vi.fn(() => []);
    linkCount = vi.fn(() => 0);
    getRoomPeerStatuses = vi.fn(() => []);
    getMyId = vi.fn(() => "peer-a");
    getMyName = vi.fn(() => "Alex");
    clearMessageListeners = vi.fn();
    sendTo = vi.fn();
    noteLocalUpdate = vi.fn();
  },
}));

const wire: DocsCollabWireOperations = {
  fetchAuthToken: vi.fn(async () => "test-token"),
  fetchRtcSettings: vi.fn(async () => DEFAULT_RTC_SETTINGS),
};

function docsUrls(room: string): DocsCollabUrls {
  const documentUrl = `/api/v1/files/collaboration?path=${encodeURIComponent(room)}`;
  return { ...DEFAULT_DOCS_COLLAB_URLS, room, documentUrl, yjsUrl: `${documentUrl}&format=yjs` };
}

function renderDocument(fileName: string) {
  const room = `users/alex/${fileName}`;
  return render(
    <DocsCollabWorkspace
      userName="Alex"
      documentTitle={fileName}
      urls={docsUrls(room)}
      wire={wire}
      docApiPath={`/${room}`}
    />,
  );
}

describe("Docs editor side menu (#1855)", () => {
  beforeEach(() => {
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    // Phone width: the side menu is an overlay, the only way back on the Home Screen app.
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Shopping list", { status: 200 })),
    );
  });

  afterEach(() => {
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the way back to docs home for a plain text file", () => {
    renderDocument("shopping.txt");
    expect(screen.getByRole("button", { name: docsLabels.sidebarBackToHome })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: docsLabels.sidebarOutline })).toBeNull();
  });

  it("shows the way back and the outline for a Markdown file", () => {
    renderDocument("plan.md");
    expect(screen.getByRole("button", { name: docsLabels.sidebarBackToHome })).toBeTruthy();
    expect(screen.getByRole("heading", { name: docsLabels.sidebarOutline })).toBeTruthy();
  });
});
