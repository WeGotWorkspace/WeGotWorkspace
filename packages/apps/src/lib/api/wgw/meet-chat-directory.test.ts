import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/calendar-scheduling", () => ({
  fetchCalendarSchedulingInvitees: vi.fn(),
}));
vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

import { fetchCalendarSchedulingInvitees } from "@/lib/api/wgw/calendar-scheduling";
import { wgwFetch } from "@/lib/api/wgw/http";
import { fetchMeetChatDirectory } from "@/lib/api/wgw/meet-chat-directory";
import { viewerHasNoTeam } from "@/share-ui/collection-share";
import { meetDirectMessagePeople } from "@/meet-core/src/meet-direct-messages";

describe("fetchMeetChatDirectory", () => {
  beforeEach(() => {
    vi.mocked(wgwFetch).mockResolvedValue(new Response(null, { status: 500 }));
  });

  it("keeps people outside the viewer's Teams for mentions but not for DMs", async () => {
    vi.mocked(fetchCalendarSchedulingInvitees).mockResolvedValue({
      canSubmitEmail: true,
      list: [
        { username: "colleague", email: "c@example.test", name: "Colleague", sharesTeam: true },
        { username: "outsider", email: "o@example.test", name: "Outsider", sharesTeam: false },
      ],
    });

    const { directory } = await fetchMeetChatDirectory();

    expect(directory.map((row) => row.id)).toEqual(["colleague", "outsider"]);
    expect(directory.find((row) => row.id === "outsider")?.sharesTeam).toBe(false);
    expect(meetDirectMessagePeople(directory).map((person) => person.id)).toEqual(["colleague"]);
  });

  it("leaves the Teams unknown when the settings request fails", async () => {
    vi.mocked(fetchCalendarSchedulingInvitees).mockResolvedValue({
      canSubmitEmail: true,
      list: [],
    });

    const result = await fetchMeetChatDirectory();

    expect(result.groups).toBeUndefined();
    expect(viewerHasNoTeam(result.groups)).toBe(false);
  });
});
