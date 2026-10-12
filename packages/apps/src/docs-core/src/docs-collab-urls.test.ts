import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { saveDocument } from "@/text-editor-core/docs-collab/docs-collab-server-io";
import { buildDocsCollabUrls } from "./docs-collab-urls";

const LONG_NAME = "a".repeat(250 - "users/alice/docs/".length - ".md".length);

const PATHS: Array<[label: string, filePath: string, room: string]> = [
  ["parentheses", "/users/alice/docs/Offerte (v2).md", "users/alice/docs/Offerte (v2).md"],
  ["accents", "/users/alice/docs/Café notities.md", "users/alice/docs/Café notities.md"],
  [
    "ampersand in a directory",
    "/users/alice/Klanten & partners/plan.md",
    "users/alice/Klanten & partners/plan.md",
  ],
  ["250 characters", `/users/alice/docs/${LONG_NAME}.md`, `users/alice/docs/${LONG_NAME}.md`],
];

function decodeFileRoomId(roomId: string): string {
  const payload = roomId.slice("f_".length).replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

describe("buildDocsCollabUrls", () => {
  it.each(PATHS)("strips the leading slash for %s", (_label, filePath, room) => {
    expect(buildDocsCollabUrls(filePath).room).toBe(room);
  });

  it.each(PATHS)("round-trips the document path query for %s", (_label, filePath, room) => {
    const urls = buildDocsCollabUrls(filePath);

    const document = new URL(urls.documentUrl, "http://localhost");
    expect(document.searchParams.get("path")).toBe(room);

    const yjs = new URL(urls.yjsUrl, "http://localhost");
    expect(yjs.searchParams.get("path")).toBe(room);
    expect(yjs.searchParams.get("format")).toBe("yjs");
  });

  it.each(PATHS)("round-trips the signaling room id for %s", (_label, filePath, room) => {
    const urls = buildDocsCollabUrls(filePath);

    expect(urls.roomId).toMatch(/^f_[A-Za-z0-9_-]+$/);
    expect(decodeFileRoomId(urls.roomId)).toBe(room);
    expect(urls.signalUrl).toContain(`/rooms/${urls.roomId}/events`);
    expect(urls.collabRtcUrl).toContain(`/rooms/${urls.roomId}/configuration`);
  });

  it.each(PATHS)(
    "saves through a URL the server can parse for %s",
    async (_label, filePath, room) => {
      const urls = buildDocsCollabUrls(filePath);
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      try {
        await saveDocument(
          urls.documentUrl,
          "# Café & co (v2)\n",
          new Y.Doc(),
          room,
          "token",
          "PUT",
        );
      } finally {
        vi.unstubAllGlobals();
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requested = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
      expect(requested.searchParams.get("path")).toBe(room);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
      expect(body.room).toBe(room);
      expect(body.markdown).toBe("# Café & co (v2)\n");
    },
  );
});
