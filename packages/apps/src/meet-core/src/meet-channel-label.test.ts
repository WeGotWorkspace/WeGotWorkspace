import { describe, expect, it } from "vitest";
import {
  meetChannelComposerPlaceholder,
  meetChannelHashName,
  meetChannelMatchesQuery,
  meetChannelMemberCount,
  meetChannelTitle,
} from "@/meet-core/src/meet-channel-label";

describe("meetChannelHashName", () => {
  it("prefixes channels with a hash and keeps meeting names plain", () => {
    expect(meetChannelHashName({ name: "Design", kind: "channel" })).toBe("# design");
    expect(meetChannelHashName({ name: "Standup", kind: "meeting" })).toBe("Standup");
  });
});

describe("meetChannelTitle", () => {
  it("uses a compact hash title for the main header", () => {
    expect(meetChannelTitle({ name: "Design", kind: "channel" })).toBe("#design");
  });
});

describe("meetChannelComposerPlaceholder", () => {
  it("asks to message the hashed channel", () => {
    expect(meetChannelComposerPlaceholder({ name: "Design", kind: "channel" })).toBe(
      "Message # design",
    );
  });
});

describe("meetChannelMemberCount", () => {
  it("prefers an explicit fixture count, then shareWith + owner", () => {
    expect(
      meetChannelMemberCount({ memberCount: 6, shareWith: { "ada.lovelace": { mayRead: true } } }),
    ).toBe(6);
    expect(meetChannelMemberCount({ shareWith: { "ada.lovelace": { mayRead: true } } })).toBe(2);
    expect(meetChannelMemberCount({})).toBe(1);
  });
});

describe("meetChannelMatchesQuery", () => {
  it("matches name or hash prefix", () => {
    expect(meetChannelMatchesQuery({ name: "Design" }, "des")).toBe(true);
    expect(meetChannelMatchesQuery({ name: "Design" }, "# des")).toBe(true);
    expect(meetChannelMatchesQuery({ name: "Design" }, "ship")).toBe(false);
  });
});
