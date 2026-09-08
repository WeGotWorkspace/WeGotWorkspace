import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import {
  MEET_CHAT_CAUGHT_UP_READ_UID,
  latestMessageInChannel,
  meetChatReadMarkerTarget,
  shouldSkipMeetChatReadMarker,
  utcDateTimeFromEpochMs,
} from "@/lib/offline/meet-chat/meet-chat-read-marker";

function message(id: string, channelId: string, createdAt: number): ChatMessage {
  return {
    id,
    channelId,
    authorId: "alice",
    authorName: "Alice",
    body: id,
    createdAt,
    reactions: [],
    mentions: [],
    previews: [],
  };
}

describe("utcDateTimeFromEpochMs", () => {
  it("formats epoch ms as JMAP UTC ISO", () => {
    expect(utcDateTimeFromEpochMs(Date.UTC(2026, 0, 15, 12, 0, 0))).toBe(
      "2026-01-15T12:00:00.000Z",
    );
  });
});

describe("latestMessageInChannel", () => {
  it("picks the newest createdAt and ULID-tiebreaks equal timestamps", () => {
    const messages = [
      message("01ARZ3NDEKTSV4RRFFQ69G5FA1", "chat-general", 1000),
      message("01ARZ3NDEKTSV4RRFFQ69G5FA3", "chat-other", 9000),
      message("01ARZ3NDEKTSV4RRFFQ69G5FA2", "chat-general", 1000),
      message("01ARZ3NDEKTSV4RRFFQ69G5FA0", "chat-general", 500),
    ];
    expect(latestMessageInChannel(messages, "chat-general")?.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FA2");
  });

  it("returns undefined when the channel has no cached rows", () => {
    expect(latestMessageInChannel([message("a", "other", 1)], "chat-general")).toBeUndefined();
  });
});

describe("meetChatReadMarkerTarget", () => {
  it("uses the latest message timestamp and ULID", () => {
    const latest = message("01ARZ3NDEKTSV4RRFFQ69G5FA2", "chat-general", Date.UTC(2026, 0, 15, 12));
    expect(meetChatReadMarkerTarget(latest)).toEqual({
      lastReadTs: "2026-01-15T12:00:00.000Z",
      lastReadUid: latest.id,
    });
  });

  it("uses a caught-up sentinel when history is empty", () => {
    expect(meetChatReadMarkerTarget(undefined, () => Date.UTC(2026, 5, 1))).toEqual({
      lastReadTs: "2026-06-01T00:00:00.000Z",
      lastReadUid: MEET_CHAT_CAUGHT_UP_READ_UID,
    });
  });
});

describe("shouldSkipMeetChatReadMarker", () => {
  const target = { lastReadTs: "2026-01-15T12:00:00.000Z", lastReadUid: "01ARZ" };

  it("skips when unread is 0 and the same last message was already marked", () => {
    expect(shouldSkipMeetChatReadMarker(0, target, target)).toBe(true);
  });

  it("does not skip when unread remains or the last message advanced", () => {
    expect(shouldSkipMeetChatReadMarker(2, target, target)).toBe(false);
    expect(shouldSkipMeetChatReadMarker(0, target, undefined)).toBe(false);
    expect(shouldSkipMeetChatReadMarker(0, target, { ...target, lastReadUid: "01OTHER" })).toBe(
      false,
    );
  });
});
