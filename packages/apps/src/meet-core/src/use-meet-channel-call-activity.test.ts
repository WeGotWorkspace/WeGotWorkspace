import { describe, expect, it } from "vitest";
import {
  meetCallActivityTargets,
  omitMeetCallActivityChannels,
} from "@/meet-core/src/use-meet-channel-call-activity";
import type { MeetChannel } from "@/meet-core/src/meet-types";

const general: MeetChannel = {
  id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  name: "general",
  kind: "channel",
  scope: "personal",
};
const weekly: MeetChannel = {
  id: "chat-01BX5ZZKBKACTAV9WEVGEMMVRZ",
  name: "weekly",
  kind: "meeting",
  scope: "personal",
  guestRoomCode: "q1w2-e3r4-t5y6",
};

describe("meetCallActivityTargets", () => {
  it("polls the selected channel's deterministic room", () => {
    expect(meetCallActivityTargets([general, weekly], general.id, null)).toEqual([
      { channelId: general.id, room: general.id.toLowerCase() },
    ]);
  });

  it("adds the joined session's channel when it differs from the selection", () => {
    expect(meetCallActivityTargets([general, weekly], general.id, "q1w2-e3r4-t5y6")).toEqual([
      { channelId: general.id, room: general.id.toLowerCase() },
      { channelId: weekly.id, room: "q1w2-e3r4-t5y6" },
    ]);
  });

  it("deduplicates when the joined channel is the selected one", () => {
    expect(
      meetCallActivityTargets([general, weekly], general.id, general.id.toLowerCase()),
    ).toEqual([{ channelId: general.id, room: general.id.toLowerCase() }]);
  });

  it("returns no targets without selection or session", () => {
    expect(meetCallActivityTargets([general, weekly], null, null)).toEqual([]);
  });

  it("includes an extra DM room when the selection is not a channel row", () => {
    expect(
      meetCallActivityTargets([general], "dm:bob", null, [
        { channelId: "dm:bob", room: "dm-0123456789abcdef0123456789abcdef01234567" },
      ]),
    ).toEqual([{ channelId: "dm:bob", room: "dm-0123456789abcdef0123456789abcdef01234567" }]);
  });
});

describe("omitMeetCallActivityChannels", () => {
  it("drops poll-true channels that mesh has already emptied", () => {
    expect(
      omitMeetCallActivityChannels({ "chat-general": true, "dm:bob": true }, ["chat-general"]),
    ).toEqual({ "dm:bob": true });
  });

  it("returns the same map when nothing is omitted", () => {
    const active = { "chat-general": true };
    expect(omitMeetCallActivityChannels(active, [])).toBe(active);
    expect(omitMeetCallActivityChannels(active, ["dm:bob"])).toBe(active);
  });
});
