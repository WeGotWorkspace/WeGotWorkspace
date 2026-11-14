import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/contacts/contacts-offline-store", () => ({
  listPendingContactCardIds: vi.fn(),
}));

import { listPendingContactCardIds } from "@/lib/offline/contacts/contacts-offline-store";
import { useContactsPendingSync } from "@/contacts-core/src/use-contacts-pending-sync";

describe("useContactsPendingSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty set and skips the read when no username is known", () => {
    const { result } = renderHook(() => useContactsPendingSync(null));
    expect(result.current.size).toBe(0);
    expect(listPendingContactCardIds).not.toHaveBeenCalled();
  });

  it("exposes the pending card ids read from the offline store", async () => {
    vi.mocked(listPendingContactCardIds).mockResolvedValue(["card-jane", "card-joe"]);
    const { result } = renderHook(() => useContactsPendingSync("bob"));

    await waitFor(() => expect(result.current.has("card-jane")).toBe(true));
    expect(result.current.has("card-joe")).toBe(true);
    expect(result.current.size).toBe(2);
  });
});
