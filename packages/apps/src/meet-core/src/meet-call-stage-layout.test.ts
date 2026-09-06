import { describe, expect, it } from "vitest";
import {
  meetCallBarVisible,
  meetCallChromeVisible,
  meetCallHeaderStartVisible,
  meetCallInviteAction,
  meetCallInviteStartOptions,
  meetCallIsActive,
  meetCallStageShowsBar,
  meetCallStageShowsChat,
  meetCallStageShowsStage,
  meetChannelMeetingLive,
  mergeMeetCallActive,
  mergeMeetCallLive,
  meetSelectedConversationLive,
  meetSidebarRowIsLive,
} from "@/meet-core/src/meet-call-stage-layout";

describe("meetCallStage layout", () => {
  it("keeps chat as the main column while the compact bar is up", () => {
    expect(meetCallIsActive("compact")).toBe(true);
    expect(meetCallStageShowsBar("compact")).toBe(true);
    expect(meetCallStageShowsChat("compact")).toBe(true);
    expect(meetCallStageShowsStage("compact")).toBe(false);
  });

  it("shows chat and stage side by side", () => {
    expect(meetCallStageShowsChat("side-by-side")).toBe(true);
    expect(meetCallStageShowsStage("side-by-side")).toBe(true);
    expect(meetCallStageShowsBar("side-by-side")).toBe(false);
  });

  it("keeps the white chat column when the stage is expanded", () => {
    expect(meetCallStageShowsChat("fullscreen")).toBe(true);
    expect(meetCallStageShowsChat("side-by-side")).toBe(true);
    expect(meetCallStageShowsStage("fullscreen")).toBe(true);
    expect(meetCallIsActive("fullscreen")).toBe(true);
  });

  it("hides the stage when collapsed", () => {
    expect(meetCallIsActive("collapsed")).toBe(false);
    expect(meetCallStageShowsBar("collapsed")).toBe(false);
    expect(meetCallStageShowsChat("collapsed")).toBe(true);
    expect(meetCallStageShowsStage("collapsed")).toBe(false);
  });

  it("shows the sticky bar only when a meeting is live and the stage is not expanded", () => {
    expect(meetCallBarVisible("collapsed", false)).toBe(false);
    expect(meetCallBarVisible("collapsed", true)).toBe(true);
    expect(meetCallBarVisible("compact", true)).toBe(true);
    expect(meetCallBarVisible("side-by-side", true)).toBe(false);
    expect(meetCallBarVisible("fullscreen", true)).toBe(false);
  });

  it("marks a sidebar row live from fixture callActive or a local join", () => {
    expect(meetSidebarRowIsLive({ channelCallActive: true })).toBe(true);
    expect(meetSidebarRowIsLive({ localCallActive: true })).toBe(true);
    expect(meetSidebarRowIsLive({ channelCallActive: false, localCallActive: false })).toBe(false);
  });

  it("ORs mesh and poll live maps so a false poll cannot hide a hint", () => {
    expect(
      mergeMeetCallActive({ "dm:bob": true }, { "chat-general": true, "dm:bob": false }),
    ).toEqual({ "dm:bob": true, "chat-general": true });
  });

  it("hides chrome when mesh emptied a channel even if the poll is still true", () => {
    expect(mergeMeetCallLive({ "chat-general": [] }, { "chat-general": true })).toEqual({});
  });

  it("keeps chrome live when mesh still has participants even if the poll is false", () => {
    expect(mergeMeetCallLive({ "chat-general": ["bob"] }, { "chat-general": false })).toEqual({
      "chat-general": true,
    });
    expect(mergeMeetCallLive({ "dm:bob": ["bob"] }, {})).toEqual({ "dm:bob": true });
  });

  it("trusts a true poll when mesh has never seen the channel", () => {
    expect(mergeMeetCallLive({}, { "chat-general": true })).toEqual({ "chat-general": true });
    expect(mergeMeetCallLive({ "dm:bob": ["bob"] }, { "chat-general": true })).toEqual({
      "dm:bob": true,
      "chat-general": true,
    });
  });

  it("keeps chrome for a local join even when mesh emptied and poll is stale", () => {
    const channelCallActive = mergeMeetCallLive({ "chat-general": [] }, { "chat-general": true })[
      "chat-general"
    ];
    expect(channelCallActive).toBeUndefined();
    expect(meetChannelMeetingLive({ channelCallActive, localCallActive: true })).toBe(true);
    expect(meetChannelMeetingLive({ channelCallActive, localCallActive: false })).toBe(false);
  });

  it("reads DM / mesh live from callActiveByChannel when the selection is not a channel row", () => {
    expect(meetSelectedConversationLive(null, "dm:bob", { "dm:bob": true })).toBe(true);
    expect(meetSelectedConversationLive(null, "dm:bob", {})).toBe(false);
    expect(meetSelectedConversationLive({ callActive: true }, "chat-general", {})).toBe(true);
    expect(meetSelectedConversationLive(null, null, { "dm:bob": true })).toBe(false);
  });

  it("treats a channel meeting as live when anyone started or the local user joined", () => {
    expect(meetChannelMeetingLive({ channelCallActive: true })).toBe(true);
    expect(meetChannelMeetingLive({ localCallActive: true })).toBe(true);
    expect(meetChannelMeetingLive({ channelCallActive: false, localCallActive: false })).toBe(
      false,
    );
  });

  it("maps sticky-bar invite to Join only, never Start", () => {
    expect(meetCallInviteAction(false, false)).toBeNull();
    expect(meetCallInviteAction(true, false)).toBe("join");
    expect(meetCallInviteAction(true, true)).toBeNull();
    expect(meetCallInviteAction(false, true)).toBeNull();
  });

  it("joins an audio-only meeting with video off", () => {
    expect(meetCallInviteStartOptions(true)).toEqual({ video: false });
    expect(meetCallInviteStartOptions(false)).toBeUndefined();
  });

  it("shows ViewHeader Start only when no meeting is live", () => {
    expect(meetCallHeaderStartVisible(false)).toBe(true);
    expect(meetCallHeaderStartVisible(true)).toBe(false);
  });

  it("hides in-call chrome buttons until the local user has joined", () => {
    expect(meetCallChromeVisible(false)).toBe(false);
    expect(meetCallChromeVisible(true)).toBe(true);
  });
});
