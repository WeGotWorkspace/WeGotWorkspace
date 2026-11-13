/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFailedOutboxCount } from "@/lib/offline/core/use-failed-outbox-count";

vi.mock("@/hooks/use-connectivity", () => ({ useConnectivity: () => ({ online: true }) }));

type Rows = readonly unknown[];

describe("useFailedOutboxCount", () => {
  it("ignores an older read that settles after a newer one", async () => {
    let resolveOld: (rows: Rows) => void = () => undefined;
    const old = new Promise<Rows>((resolve) => {
      resolveOld = resolve;
    });
    const listFailed = vi
      .fn<(username: string) => Promise<Rows>>()
      .mockReturnValueOnce(old)
      .mockResolvedValue([]);
    const { result } = renderHook(() => useFailedOutboxCount("alice", listFailed));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.count).toBe(0);

    await act(async () => {
      resolveOld([{ id: "stale" }]);
      await old;
    });
    expect(result.current.count).toBe(0);
  });
});
