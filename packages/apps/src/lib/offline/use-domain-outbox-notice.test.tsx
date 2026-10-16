/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { writeMeta } from "@/lib/offline/core/meta-store";
import { enqueueOutboxMutation, markOutboxError } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import {
  reportDocsSyncConflicts,
  setDocsSyncConflictListener,
} from "@/lib/offline/docs/docs-sync-conflicts";
import { KEPT_UNSAVED_DOCUMENTS_META_KEY } from "@/lib/offline/drive/drive-fetched-set-prune";
import { useDomainOutboxNotice } from "@/lib/offline/use-domain-outbox-notice";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";

const show = vi.fn<(title: string, options?: AppToastShowOptions) => string>(() => "toast-1");
const dismiss = vi.fn();

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, dismiss }),
}));

const username = "alice";

function NoticeHarness({ onClear }: { onClear?: (clear: () => void) => void }) {
  const notice = useDomainOutboxNotice({
    username,
    domain: DOCS_DOMAIN,
    setConflictListener: setDocsSyncConflictListener,
  });
  useEffect(() => {
    onClear?.(notice.clearConflicts);
  }, [notice.clearConflicts, onClear]);
  useSyncRetryToast({
    active: notice.active,
    title: docsLabels.syncFailedTitle,
    message: docsLabels.syncFailedMessage,
    retryLabel: docsLabels.retrySync,
    onRetry: () => notice.clearConflicts(),
  });
  return null;
}

async function seedPendingSave(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

async function enqueueFailed(id: string, lastError: string): Promise<void> {
  await enqueueOutboxMutation(username, {
    id,
    domain: DOCS_DOMAIN,
    op: "rename",
    payload: JSON.stringify({
      op: "rename",
      from: "/users/alice/a.md",
      destination: "/",
      to: "b.md",
    }),
  });
  await markOutboxError(username, id, lastError);
}

describe("useDomainOutboxNotice", () => {
  beforeEach(async () => {
    show.mockClear();
    dismiss.mockClear();
    setDocsSyncConflictListener(undefined);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
  });

  it("shows a permanently failed 404 row in the sync notice", async () => {
    await enqueueFailed("row-404", "GET failed (404)");

    render(<NoticeHarness />);

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        docsLabels.syncFailedTitle,
        expect.objectContaining({
          description: docsLabels.syncFailedMessage,
          severity: "error",
          canRetry: true,
          retryLabel: docsLabels.retrySync,
          duration: Number.POSITIVE_INFINITY,
        }),
      );
    });
  });

  it("shows a transient outbox failure in the same sync notice", async () => {
    await enqueueFailed("row-net", "network down");

    render(<NoticeHarness />);

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        docsLabels.syncFailedTitle,
        expect.objectContaining({ description: docsLabels.syncFailedMessage }),
      );
    });
  });

  it("shows a notice for a document kept because it still has unsaved work", async () => {
    await seedPendingSave("/users/alice/unsaved.md");
    await writeMeta(
      username,
      KEPT_UNSAVED_DOCUMENTS_META_KEY,
      JSON.stringify(["users/alice/unsaved.md"]),
    );

    render(<NoticeHarness />);

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        docsLabels.syncFailedTitle,
        expect.objectContaining({ description: docsLabels.syncFailedMessage }),
      );
    });
  });

  it("turns the notice off when conflicts are cleared", async () => {
    let clear = (): void => undefined;
    render(<NoticeHarness onClear={(fn) => (clear = fn)} />);

    await act(async () => {
      reportDocsSyncConflicts(["users/alice/a.md"]);
    });
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalled();
    });

    dismiss.mockClear();
    await act(async () => {
      clear();
    });
    await vi.waitFor(() => {
      expect(dismiss).toHaveBeenCalled();
    });
  });

  it("turns the notice off when the conflict channel reports an empty list", async () => {
    render(<NoticeHarness />);

    await act(async () => {
      reportDocsSyncConflicts(["users/alice/a.md"]);
    });
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalled();
    });

    dismiss.mockClear();
    await act(async () => {
      reportDocsSyncConflicts([]);
    });
    await vi.waitFor(() => {
      expect(dismiss).toHaveBeenCalled();
    });
  });
});
