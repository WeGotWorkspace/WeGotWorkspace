/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab/docs-collab-types";

const harness = vi.hoisted(() => ({
  prompt: false,
}));

vi.mock("@/text-editor-core/docs-collab", async () => {
  const React = await import("react");
  return {
    useDocsCollab: (options: { urls?: DocsCollabUrls }) => {
      React.useEffect(() => {
        if (!harness.prompt) return;
        options.urls?.onExternalWrite?.({ markdown: "from outside", title: "Outside" });
      }, [options.urls]);
      return {
        onMarkdownChange: vi.fn(),
        registerMarkdownGetter: vi.fn(),
        session: null,
        scheduleSave: vi.fn(),
        resolveExternalWrite: vi.fn(async () => undefined),
        peers: [],
        connectingPeers: [],
        warningPeers: [],
      };
    },
    DocsCollabEditor: () => null,
    DocsCollabPresenceChrome: () => null,
    mergeCollabPresencePeers: () => [],
    useDocsCollabAwarenessPresence: () => [],
  };
});

import { NoteCollabSession } from "./note-text-editor-body";

const urls: DocsCollabUrls = {
  signalUrl: "/rooms/n1/events",
  documentUrl: "/notes/items/n1",
  yjsUrl: "/notes/items/n1?format=yjs",
  room: "n1",
};

function renderSession() {
  return render(
    <NoteCollabSession
      userName="Alex"
      urls={urls}
      initialMarkdown="local draft"
      localDisplayName="Alex"
      documentTitle="Shopping"
    >
      <p>editor</p>
    </NoteCollabSession>,
  );
}

describe("NoteCollabSession prompts", () => {
  beforeEach(() => {
    harness.prompt = false;
  });

  it("shows the outside-write prompt and not the retired choice screen", async () => {
    harness.prompt = true;
    renderSession();

    expect(await screen.findByRole("dialog", { name: "Changed outside the app" })).toBeTruthy();
    expect(screen.getByText(/Nothing has been overwritten/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep my edits" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use the outside version" })).toBeTruthy();
    expect(screen.queryByText("Sync conflict")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep mine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use server" })).toBeNull();
  });

  it("shows no prompt when nothing outside the app changed the note", async () => {
    renderSession();

    expect(screen.getByText("editor")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.queryByText("Sync conflict")).toBeNull();
    expect(screen.queryByText("Changed outside the app")).toBeNull();
  });
});
