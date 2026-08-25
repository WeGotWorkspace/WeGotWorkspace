import { describe, expect, it, vi } from "vitest";
import type { JmapClient } from "@/lib/jmap-client";
import { deleteCalendarLive } from "@/lib/api/wgw/calendar";

describe("deleteCalendarLive", () => {
  it("destroys the calendar and its events", async () => {
    const call = vi.fn().mockResolvedValue({
      accountId: "bob",
      oldState: "1",
      newState: "2",
      destroyed: ["work"],
    });
    const client = {
      isConnected: true,
      primaryAccountId: () => "bob",
      call,
      setState: vi.fn(),
    } as unknown as JmapClient;

    await deleteCalendarLive("work", client);

    expect(call).toHaveBeenCalledWith("Calendar/set", {
      accountId: "bob",
      destroy: ["work"],
      onDestroyRemoveEvents: true,
    });
  });
});
