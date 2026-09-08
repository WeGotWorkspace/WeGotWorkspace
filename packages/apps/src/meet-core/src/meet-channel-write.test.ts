import { describe, expect, it } from "vitest";
import { canDeleteMeetChannel } from "@/meet-core/src/meet-channel-write";

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
