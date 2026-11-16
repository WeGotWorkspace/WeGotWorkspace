import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/contacts/contacts-offline-store", () => ({
  listFailedContactOutbox: vi.fn(),
}));

import { listFailedContactOutbox } from "@/lib/offline/contacts/contacts-offline-store";
import { useContactsFailedSync } from "@/contacts-core/src/use-contacts-failed-sync";

describe("useContactsFailedSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 and skips the read when no username is known", () => {
    const { result } = renderHook(() => useContactsFailedSync(undefined));
    expect(result.current).toBe(0);
    expect(listFailedContactOutbox).not.toHaveBeenCalled();
  });

  it("counts the failed outbox rows for the account", async () => {
    vi.mocked(listFailedContactOutbox).mockResolvedValue([
      {
        id: "a",
        domain: "contacts",
        op: "update",
        payload: "{}",
        createdAt: 1,
        retries: 2,
        lastError: "boom",
      },
      {
        id: "b",
        domain: "contacts",
        op: "update",
        payload: "{}",
        createdAt: 2,
        retries: 1,
        lastError: "boom",
      },
    ]);
    const { result } = renderHook(() => useContactsFailedSync("bob"));
    await waitFor(() => expect(result.current).toBe(2));
  });
});
