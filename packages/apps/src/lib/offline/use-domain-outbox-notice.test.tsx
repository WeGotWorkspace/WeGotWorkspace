/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
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
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";

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
  const syncNotice = useSyncRetryNotice({
    id: "sync:docs",
    active: notice.active,
    title: docsLabels.syncFailedNotice,
    retryLabel: docsLabels.retrySync,
    onRetry: () => notice.clearConflicts(),
  });
  return <NoticeBar label={docsLabels.noticeBarLabel} notices={[syncNotice]} />;
}

function noticeRow(): HTMLElement | null {
  return screen.queryByRole("region", { name: docsLabels.noticeBarLabel });
}

async function expectNoticeShown(): Promise<void> {
  await vi.waitFor(() => {
    expect(noticeRow()?.textContent).toContain(docsLabels.syncFailedNotice);
    const retry = screen.getByRole<HTMLButtonElement>("button", { name: docsLabels.retrySync });
    expect(retry.disabled).toBe(false);
  });
}

async function expectNoticeGone(): Promise<void> {
  await vi.waitFor(() => {
    expect(noticeRow()).toBeNull();
  });
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
    setDocsSyncConflictListener(undefined);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
  });

  it("shows a permanently failed 404 row in the sync notice", async () => {
    await enqueueFailed("row-404", "GET failed (404)");

    render(<NoticeHarness />);

    await expectNoticeShown();
  });

  it("shows a transient outbox failure in the same sync notice", async () => {
    await enqueueFailed("row-net", "network down");

    render(<NoticeHarness />);

    await expectNoticeShown();
  });

  it("shows a notice for a document kept because it still has unsaved work", async () => {
    await seedPendingSave("/users/alice/unsaved.md");
    await writeMeta(
      username,
      KEPT_UNSAVED_DOCUMENTS_META_KEY,
      JSON.stringify(["users/alice/unsaved.md"]),
    );

    render(<NoticeHarness />);

    await expectNoticeShown();
  });

  it("turns the notice off when conflicts are cleared", async () => {
    let clear = (): void => undefined;
    render(<NoticeHarness onClear={(fn) => (clear = fn)} />);

    await act(async () => {
      reportDocsSyncConflicts(["users/alice/a.md"]);
    });
    await expectNoticeShown();

    await act(async () => {
      clear();
    });
    await expectNoticeGone();
  });

  it("turns the notice off when the conflict channel reports an empty list", async () => {
    render(<NoticeHarness />);

    await act(async () => {
      reportDocsSyncConflicts(["users/alice/a.md"]);
    });
    await expectNoticeShown();

    await act(async () => {
      reportDocsSyncConflicts([]);
    });
    await expectNoticeGone();
  });
});
