/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { rememberSidecarEtag, resetSidecarEtagsForTests } from "./docs-collab-etag";
import { persistCollabSave } from "./docs-collab-save-attempt";
import type { DocsCollabUrls } from "./docs-collab-types";
import { isArchivedRefusal, isExternalWriteRefusal } from "./docs-collab-utils";

const { reportDocsSyncConflicts } = vi.hoisted(() => ({ reportDocsSyncConflicts: vi.fn() }));

vi.mock("@/lib/offline/docs/docs-sync-conflicts", () => ({ reportDocsSyncConflicts }));

const urls: DocsCollabUrls = {
  signalUrl: "/events",
  collabApiBaseUrl: "/rooms",
  collabRtcUrl: "/rooms/configuration",
  room: "users/ada/note.md",
  documentUrl: "/files/collaboration?path=users%2Fada%2Fnote.md",
  yjsUrl: "/files/collaboration?path=users%2Fada%2Fnote.md&format=yjs",
};

function collaboratorState(): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("collaborator").insert(0, "saved meanwhile");
  return Y.encodeStateAsUpdate(doc);
}

describe("persistCollabSave", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetSidecarEtagsForTests();
  });

  it("frees the remerge for later when the remerged save meets an outside edit", async () => {
    const statuses = [412, 409];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "PUT") {
          const status = statuses.shift() ?? 200;
          const error = status === 409 ? "external_write" : "precondition_failed";
          return new Response(JSON.stringify({ error }), { status });
        }
        expect(String(input)).toContain("format=yjs");
        return new Response(collaboratorState() as unknown as BodyInit, {
          status: 200,
          headers: { ETag: '"collaborator"' },
        });
      }),
    );
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    rememberSidecarEtag(urls.room!, '"stale"');
    const remergeAttempted = { current: false };

    const refusal = await persistCollabSave({
      urls,
      room: urls.room!,
      ydoc: new Y.Doc(),
      markdown: "mine",
      remergeAttempted,
      markdownAfterMerge: () => "mine",
    }).catch((error: unknown) => error);

    expect(isExternalWriteRefusal(refusal)).toBe(true);
    // A collaborator's next save must still remerge, not open the conflict dialog.
    expect(remergeAttempted.current).toBe(false);
  });

  it("stops on an archived note: no remerge and no sync conflict (#1535)", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "note_archived", code: "note_archived" }, { status: 409 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    reportDocsSyncConflicts.mockClear();

    const refusal = await persistCollabSave({
      urls,
      room: urls.room!,
      ydoc: new Y.Doc(),
      markdown: "typed offline",
      remergeAttempted: { current: false },
      markdownAfterMerge: () => "typed offline",
    }).catch((error: unknown) => error);

    expect(isArchivedRefusal(refusal)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(reportDocsSyncConflicts).not.toHaveBeenCalled();
  });
});
