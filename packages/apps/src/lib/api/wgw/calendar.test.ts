import { describe, expect, it, vi } from "vitest";
import type { JmapClient } from "@/lib/jmap-client";
import { deleteCalendarLive, fetchCalendarBootstrapForClient } from "@/lib/api/wgw/calendar";

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

describe("fetchCalendarBootstrapForClient", () => {
  it("surfaces the session error even when the calendar request fails first", async () => {
    const client = {
      isConnected: false,
      connect: vi.fn().mockRejectedValue(new Error("Failed to fetch JMAP session (500)")),
    } as unknown as JmapClient;
    const session = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("GET /me failed (500)")), 10),
    );

    await expect(fetchCalendarBootstrapForClient(client, session)).rejects.toThrow("GET /me");
  });
});
