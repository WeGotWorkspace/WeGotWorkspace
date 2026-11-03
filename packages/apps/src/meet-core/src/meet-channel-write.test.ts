import { describe, expect, it } from "vitest";
import {
  canChangeMeetChannelOwner,
  canDeleteMeetChannel,
} from "@/meet-core/src/meet-channel-write";

describe("canChangeMeetChannelOwner", () => {
  it("allows owners and locks sharees", () => {
    expect(canChangeMeetChannelOwner({ isSharee: false, scope: "personal" })).toBe(true);
    expect(canChangeMeetChannelOwner({ isSharee: true, scope: "personal" })).toBe(false);
    expect(canChangeMeetChannelOwner()).toBe(false);
  });

  it("locks a group channel for members without the delete right", () => {
    expect(canChangeMeetChannelOwner({ scope: "group", myRights: { mayDelete: false } })).toBe(
      false,
    );
    expect(canChangeMeetChannelOwner({ scope: "group", myRights: { mayDelete: true } })).toBe(true);
    expect(canChangeMeetChannelOwner({ scope: "personal", myRights: { mayDelete: false } })).toBe(
      true,
    );
  });
});

describe("canDeleteMeetChannel", () => {
  it("allows ordinary owned channels", () => {
    expect(canDeleteMeetChannel({ isSharee: false })).toBe(true);
    expect(canDeleteMeetChannel({ myRights: { mayDelete: true } })).toBe(true);
  });

  it("allows owned meeting channels the same way as chat channels", () => {
    expect(canDeleteMeetChannel({ isSharee: false, myRights: { mayDelete: true } })).toBe(true);
    expect(canDeleteMeetChannel({ isSharee: false })).toBe(true);
  });

  it("hides owner delete for sharees and mayDelete false", () => {
    expect(canDeleteMeetChannel({ isSharee: true })).toBe(false);
    expect(canDeleteMeetChannel({ isSharee: true, myRights: { mayDelete: true } })).toBe(false);
    expect(canDeleteMeetChannel({ myRights: { mayDelete: false } })).toBe(false);
    expect(canDeleteMeetChannel()).toBe(false);
  });
});
