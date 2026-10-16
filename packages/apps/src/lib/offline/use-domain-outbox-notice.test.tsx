/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import { enqueueOutboxMutation } from "@/lib/offline/core/outbox-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { setDocsSyncConflictListener } from "@/lib/offline/docs/docs-sync-conflicts";
import { markOutboxError } from "@/lib/offline/core/outbox-store";
import { useDomainOutboxNotice } from "@/lib/offline/use-domain-outbox-notice";

const show = vi.fn<(title: string, options?: AppToastShowOptions) => string>(() => "toast-1");
const dismiss = vi.fn();

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show, dismiss }),
}));

const username = "alice";

function NoticeHarness({ username: name }: { username: string }) {
  const notice = useDomainOutboxNotice({
    username: name,
    domain: DOCS_DOMAIN,
    setConflictListener: setDocsSyncConflictListener,
  });
  useSyncRetryToast({
    active: notice.active,
    title: "Some changes could not sync",
    message: "Your edits are saved locally. Retry when you are back online.",
    retryLabel: "Retry sync",
    onRetry: () => undefined,
  });
  return null;
}

describe("useDomainOutboxNotice", () => {
  beforeEach(async () => {
    show.mockClear();
    dismiss.mockClear();
    setDocsSyncConflictListener(undefined);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
  });

  it("shows a permanently failed outbox row in the retry notice", async () => {
    await enqueueOutboxMutation(username, {
      id: "row-404",
      domain: DOCS_DOMAIN,
      op: "rename",
      payload: JSON.stringify({
        op: "rename",
        from: "/users/alice/a.md",
        destination: "/",
        to: "b.md",
      }),
    });
    await markOutboxError(username, "row-404", "GET failed (404)");

    render(<NoticeHarness username={username} />);

    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        "Some changes could not sync",
        expect.objectContaining({
          severity: "error",
          canRetry: true,
          retryLabel: "Retry sync",
          duration: Number.POSITIVE_INFINITY,
        }),
      );
    });
  });
});
