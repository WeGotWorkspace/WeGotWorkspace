/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab/docs-collab-types";

const harness = vi.hoisted(() => ({
  prompt: false,
  outsideMarkdown: "from outside",
  answerFails: false,
  session: null as { ydoc: unknown; user: { name: string } } | null,
}));

vi.mock("@/text-editor-core/docs-collab", async () => {
  const React = await import("react");
  return {
    useDocsCollab: (options: { urls?: DocsCollabUrls }) => {
      React.useEffect(() => {
        if (!harness.prompt) return;
        options.urls?.onExternalWrite?.({
          markdown: harness.outsideMarkdown,
          title: "Outside",
          serverStateVector: new Uint8Array([0]),
        });
      }, [options.urls]);
      return {
        onMarkdownChange: vi.fn(),
        registerMarkdownGetter: vi.fn(),
        session: harness.session,
        scheduleSave: vi.fn(),
        resolveExternalWrite: vi.fn(async () => {
          if (harness.answerFails) throw new Error("HTTP 503");
        }),
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

function renderSession(sessionUrls: DocsCollabUrls = urls) {
  return render(
    <NoteCollabSession
      userName="Alex"
      urls={sessionUrls}
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
    harness.answerFails = false;
    harness.session = null;
    harness.outsideMarkdown = "from outside";
  });

  it("rebuilds the outside version as markdown even when the note UID ends in .json", async () => {
    harness.prompt = true;
    harness.outsideMarkdown = "# Outside heading";
    const ydoc = new Y.Doc();
    harness.session = { ydoc, user: { name: "Alex" } };
    renderSession({ ...urls, room: "n1@host.json" });

    fireEvent.click(await screen.findByRole("button", { name: "Use the outside version" }));

    await waitFor(() => expect(ydoc.getXmlFragment("default").toString()).toContain("<heading"));
  });

  it("keeps the dialog usable when the save behind Keep my edits fails", async () => {
    harness.prompt = true;
    harness.answerFails = true;
    renderSession();

    fireEvent.click(await screen.findByRole("button", { name: "Keep my edits" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Keep my edits" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(screen.getByRole("dialog", { name: "Changed outside the app" })).toBeTruthy();
  });

  it("disables Keep my edits once the outside version replaced the note, even if its save failed", async () => {
    harness.prompt = true;
    harness.answerFails = true;
    harness.session = { ydoc: new Y.Doc(), user: { name: "Alex" } };
    renderSession();

    fireEvent.click(await screen.findByRole("button", { name: "Use the outside version" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Use the outside version" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(screen.getByRole("dialog", { name: "Changed outside the app" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep my edits" })).toHaveProperty("disabled", true);
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
