import { describe, expect, it } from "vitest";
import {
  meetCallBarVisible,
  meetCallChromeVisible,
  meetCallInviteAction,
  meetCallIsActive,
  meetCallStageShowsBar,
  meetCallStageShowsChat,
  meetCallStageShowsStage,
  meetChannelMeetingLive,
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

  it("shows the compact bar for idle Start, live Join, and joined AV", () => {
    expect(meetCallBarVisible("collapsed")).toBe(true);
    expect(meetCallBarVisible("compact")).toBe(true);
    expect(meetCallBarVisible("side-by-side")).toBe(false);
    expect(meetCallBarVisible("fullscreen")).toBe(false);
  });

  it("marks a sidebar row live from fixture callActive or a local join", () => {
    expect(meetSidebarRowIsLive({ channelCallActive: true })).toBe(true);
    expect(meetSidebarRowIsLive({ localCallActive: true })).toBe(true);
    expect(meetSidebarRowIsLive({ channelCallActive: false, localCallActive: false })).toBe(false);
  });

  it("treats a channel meeting as live when anyone started or the local user joined", () => {
    expect(meetChannelMeetingLive({ channelCallActive: true })).toBe(true);
    expect(meetChannelMeetingLive({ localCallActive: true })).toBe(true);
    expect(meetChannelMeetingLive({ channelCallActive: false, localCallActive: false })).toBe(
      false,
    );
  });

  it("maps the bar invite to Start or Join, and hides it after join", () => {
    expect(meetCallInviteAction(false, false)).toBe("start");
    expect(meetCallInviteAction(true, false)).toBe("join");
    expect(meetCallInviteAction(true, true)).toBeNull();
    expect(meetCallInviteAction(false, true)).toBeNull();
  });

  it("hides in-call chrome buttons until the local user has joined", () => {
    expect(meetCallChromeVisible(false)).toBe(false);
    expect(meetCallChromeVisible(true)).toBe(true);
  });
});
