import { describe, expect, it, vi } from "vitest";
import { createMeetCallStore } from "@/meet-core/src/meet-call-store";

describe("MeetCallStore", () => {
  it("updates the snapshot immutably and notifies subscribers", () => {
    const store = createMeetCallStore();
    const listener = vi.fn();
    store.subscribe(listener);

    const before = store.getSnapshot();
    store.setStatus("in-call");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().status).toBe("in-call");
    expect(before.status).toBe("idle");
  });

  it("supports functional updates", () => {
    const store = createMeetCallStore();
    store.setMicOn(true);
    store.setMicOn((prev) => !prev);
    expect(store.getSnapshot().micOn).toBe(false);

    store.setChatMessages([
      { id: "1", fromPeerId: "a", fromName: "A", body: "hi", ts: 0, isSelf: false },
    ]);
    store.setChatMessages((prev) => prev.filter((line) => line.id !== "1"));
    expect(store.getSnapshot().chatMessages).toEqual([]);
  });

  it("skips notifications when the value is unchanged", () => {
    const store = createMeetCallStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setStatus("idle");
    expect(listener).not.toHaveBeenCalled();
  });

  it("mirrors setter writes into the corresponding refs synchronously", () => {
    const store = createMeetCallStore();

    store.setStatus("preparing");
    store.setRoomCode("abcd-efgh-ijkl");
    store.setSelfId("peer-1");
    store.setWaitingForAdmission(true);
    store.setMicOn(false);
    store.setVideoOn(false);
    store.setScreenOn(true);

    expect(store.statusRef.current).toBe("preparing");
    expect(store.roomCodeRef.current).toBe("abcd-efgh-ijkl");
    expect(store.selfIdRef.current).toBe("peer-1");
    expect(store.waitingForAdmissionRef.current).toBe(true);
    expect(store.micOnRef.current).toBe(false);
    expect(store.videoOnRef.current).toBe(false);
    expect(store.screenOnRef.current).toBe(true);
  });

  it("initializes the display name once; user edits win afterwards", () => {
    const store = createMeetCallStore();

    store.initializeDisplayName("Alice");
    expect(store.getSnapshot().displayName).toBe("Alice");
    expect(store.displayNameRef.current).toBe("Alice");

    // Remount with a different default must not clobber the first value.
    store.initializeDisplayName("Guest");
    expect(store.getSnapshot().displayName).toBe("Alice");

    store.setDisplayName("Custom");
    store.initializeDisplayName("Alice");
    expect(store.getSnapshot().displayName).toBe("Custom");
  });

  it("does not lock in an empty display name default", () => {
    const store = createMeetCallStore();
    store.initializeDisplayName("  ");
    store.initializeDisplayName("Alice");
    expect(store.getSnapshot().displayName).toBe("Alice");
  });

  it("refreshes an initialized default once the real identity resolves", () => {
    const store = createMeetCallStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // Pre-bootstrap mount latches the placeholder.
    store.initializeDisplayName("Guest");
    expect(store.getSnapshot().displayName).toBe("Guest");

    store.refreshDisplayName("Admin User");
    expect(store.getSnapshot().displayName).toBe("Admin User");
    expect(store.displayNameRef.current).toBe("Admin User");
    expect(listener).toHaveBeenCalled();

    // A later default (e.g. remount before the next bootstrap) must not clobber it.
    store.initializeDisplayName("Guest");
    expect(store.getSnapshot().displayName).toBe("Admin User");
  });

  it("never refreshes over a user-edited display name, and ignores blanks", () => {
    const store = createMeetCallStore();

    store.setDisplayName("Custom");
    store.refreshDisplayName("Admin User");
    expect(store.getSnapshot().displayName).toBe("Custom");

    const fresh = createMeetCallStore();
    fresh.initializeDisplayName("Guest");
    fresh.refreshDisplayName("   ");
    expect(fresh.getSnapshot().displayName).toBe("Guest");
  });

  it("resets peer maps and idle media defaults", () => {
    const store = createMeetCallStore();
    store.rosterRef.current.set("p1", "Peer");
    store.peerNamesRef.current.set("p1", "Peer");
    store.participantRosterDiffReadyRef.current = true;
    store.peerDisclosedMediaRef.current.set("p1", { mic: true, camera: true });
    store.setScreenOn(true);
    store.setMicOn(false);
    store.setVideoOn(false);

    store.resetPeerMaps();
    store.resetIdleMediaDefaults();

    expect(store.rosterRef.current.size).toBe(0);
    expect(store.peerNamesRef.current.size).toBe(0);
    expect(store.participantRosterDiffReadyRef.current).toBe(false);
    expect(store.peerDisclosedMediaRef.current.size).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ screenOn: false, micOn: true, videoOn: true });
  });

  it("keeps session holders stable for closures that outlive a mount", () => {
    const store = createMeetCallStore();
    const localStreamRef = store.localStreamRef;
    const leaveRef = store.leaveRef;

    const leave = vi.fn(async () => {});
    leaveRef.current = leave;

    // A later reader (e.g. mini-player) sees the same holders.
    expect(store.localStreamRef).toBe(localStreamRef);
    expect(store.leaveRef.current).toBe(leave);
  });
});
