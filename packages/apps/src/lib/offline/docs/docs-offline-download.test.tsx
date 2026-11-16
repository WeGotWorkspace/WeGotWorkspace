import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  downloadOfflineDocsFile,
  readOfflineDocsFileBlob,
  triggerBrowserBlobDownload,
} from "@/lib/offline/docs/docs-offline-download";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { collabDocumentFormat } from "@/lib/collab/docs-collab-utils";

const username = "alice";

async function seedCollabRoom(room: string, content: string): Promise<void> {
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, content, collabDocumentFormat(room));
  const persistence = new IndexeddbPersistence(room, ydoc);
  await persistence.whenSynced;
  await persistence.destroy();
  ydoc.destroy();
}

describe("docs offline download", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("reads collab-backed markdown from y-indexeddb", async () => {
    await seedCollabRoom("users/alice/note.md", "# Offline note");
    const blob = await readOfflineDocsFileBlob(username, "/users/alice/note.md");
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toContain("Offline note");
  });

  it("reads queued create content from the outbox", async () => {
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: DOCS_DOMAIN,
      op: "create",
      payload: JSON.stringify({
        op: "create",
        apiPath: "/users/alice/new.md",
        content: "# Queued create",
      }),
    });

    const blob = await readOfflineDocsFileBlob(username, "/users/alice/new.md");
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("# Queued create");
  });

  it("triggers a browser download for offline content", async () => {
    await seedCollabRoom("users/alice/note.md", "Download me");
    const anchorClick = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: anchorClick });
      }
      return element as HTMLAnchorElement;
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:offline");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    await downloadOfflineDocsFile(username, "/users/alice/note.md");

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:offline");

    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("throws when no offline copy exists", async () => {
    await expect(downloadOfflineDocsFile(username, "/users/alice/missing.md")).rejects.toThrow(
      "This file is not available offline.",
    );
  });

  it("exports triggerBrowserBlobDownload for reuse", () => {
    const anchorClick = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: anchorClick });
      }
      return element as HTMLAnchorElement;
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    triggerBrowserBlobDownload(new Blob(["x"], { type: "text/plain" }), "x.txt");
    expect(anchorClick).toHaveBeenCalledTimes(1);

    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
