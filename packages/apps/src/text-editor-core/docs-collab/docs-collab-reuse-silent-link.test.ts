import { describe, expect, it, vi } from "vitest";
import {
  attachReusePayload,
  type CollabReuseEnvelope,
} from "@/lib/rtc/session/collab-reuse-envelope";
import { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import {
  COLLAB_REUSE_ACK_TIMEOUT_MS,
  DocsCollabPrincipalReuse,
} from "@/text-editor-core/docs-collab/docs-collab-principal-reuse";
import { COLLAB_REUSE_SILENT_LINK_MS } from "@/text-editor-core/docs-collab/docs-collab-reuse-liveness";
import type { DocsCollabMeshMessage } from "@/text-editor-core/docs-collab/docs-collab-types";

vi.mock("@/lib/rtc/log", () => ({
  rtcLog: vi.fn(),
}));

const ROOM = "/groups/team/racing-open.md";
const ADMIN = "aaaaaaaaaaaaaaaa";
const MEMBER = "bbbbbbbbbbbbbbbb";

type Timer = { delay: number; fn: () => void; cleared: boolean };

/** One browser: its own link registry, reuse instance and fake clock. */
function browser(user: string, collabPeerId: string, name: string) {
  const registry = new PrincipalLinkRegistry();
  const messages: DocsCollabMeshMessage[] = [];
  const fallbacks: Array<string | undefined> = [];
  const timers: Timer[] = [];
  const reuse = new DocsCollabPrincipalReuse({
    room: ROOM,
    registry,
    getMyCollabPeerId: () => collabPeerId,
    getMyName: () => name,
    onDcOpen: () => undefined,
    onLinkChange: () => undefined,
    onReuseFallback: (id) => fallbacks.push(id),
    onMessage: (msg) => messages.push(msg),
    setTimeoutFn: ((fn: () => void, delay?: number) => {
      timers.push({ delay: delay ?? 0, fn, cleared: false });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: ((handle: ReturnType<typeof setTimeout>) => {
      const timer = timers[(handle as unknown as number) - 1];
      if (timer) timer.cleared = true;
    }) as typeof clearTimeout,
  });
  return {
    user,
    collabPeerId,
    registry,
    reuse,
    messages,
    fallbacks,
    runTimers(delay: number) {
      for (const timer of timers) {
        if (timer.cleared || timer.delay !== delay) continue;
        timer.cleared = true;
        timer.fn();
      }
    },
  };
}

type Browser = ReturnType<typeof browser>;

/**
 * Register on `from` a principal link to `to`. `from` knows the remote end as
 * `remotePrincipalId`; `to` sees the traffic arrive from `localPrincipalId`.
 * `deliver` decides which envelopes the wire carries.
 */
function link(
  from: Browser,
  to: Browser,
  ids: { remotePrincipalId: string; localPrincipalId: string },
  deliver: (envelope: CollabReuseEnvelope) => boolean = () => true,
) {
  from.registry.registerLink({
    username: to.user,
    principalPeerId: ids.remotePrincipalId,
    send: (payload, bytes) => {
      const envelope = payload as CollabReuseEnvelope;
      if (!deliver(envelope)) return;
      void to.registry.receive(
        from.user,
        ids.localPrincipalId,
        attachReusePayload(envelope, bytes ?? null),
      );
    },
  });
}

function rosterBoth(admin: Browser, member: Browser) {
  admin.reuse.considerRoster([{ id: MEMBER, name: "Member", user: "member" }], ADMIN);
  member.reuse.considerRoster([{ id: ADMIN, name: "Admin", user: "admin" }], MEMBER);
}

function syncMessage(text: string): DocsCollabMeshMessage {
  return { type: "sync", u: new TextEncoder().encode(text) } as DocsCollabMeshMessage;
}

describe("DocsCollabPrincipalReuse when both open a document at once (#2061)", () => {
  it("delivers updates when each side holds a different Team-room link to the other", () => {
    const admin = browser("admin", ADMIN, "Admin");
    const member = browser("member", MEMBER, "Member");
    // Two shared Team rooms. Admin's tab picked room 1, the member's tab still
    // only has room 2 open, so each side receives on a link it does not hold.
    link(admin, member, { remotePrincipalId: "member-r1", localPrincipalId: "admin-r1" });
    link(member, admin, { remotePrincipalId: "admin-r2", localPrincipalId: "member-r2" });
    rosterBoth(admin, member);

    expect(admin.reuse.shouldSkipIce({ id: MEMBER, name: "Member", user: "member" })).toBe(true);
    expect(member.reuse.shouldSkipIce({ id: ADMIN, name: "Admin", user: "admin" })).toBe(true);

    expect(member.reuse.sendTo(ADMIN, syncMessage("member-line"))).toBe(true);
    expect(admin.messages.map((msg) => ("from" in msg ? msg.from : null))).toEqual([MEMBER]);

    admin.reuse.broadcast(syncMessage("admin-line"));
    expect(member.messages.map((msg) => ("from" in msg ? msg.from : null))).toEqual([ADMIN]);
  });

  it("replaces a reused link that delivers nothing with fresh ICE", () => {
    const admin = browser("admin", ADMIN, "Admin");
    const member = browser("member", MEMBER, "Member");
    const handshakeOnly = (envelope: CollabReuseEnvelope) => envelope.op !== "data";
    link(
      admin,
      member,
      { remotePrincipalId: "member-r1", localPrincipalId: "admin-r1" },
      handshakeOnly,
    );
    link(
      member,
      admin,
      { remotePrincipalId: "admin-r1", localPrincipalId: "member-r1" },
      handshakeOnly,
    );
    rosterBoth(admin, member);
    admin.reuse.sendTo(MEMBER, syncMessage("step-1"));
    member.reuse.sendTo(ADMIN, syncMessage("step-1"));
    expect(admin.messages).toEqual([]);
    expect(member.messages).toEqual([]);

    admin.runTimers(COLLAB_REUSE_SILENT_LINK_MS);

    expect(admin.fallbacks).toEqual([MEMBER]);
    expect(admin.reuse.shouldSkipIce({ id: MEMBER, name: "Member", user: "member" })).toBe(false);
    // The close reaches the member, which leaves reuse as well.
    expect(member.fallbacks).toEqual([ADMIN]);
    expect(member.reuse.shouldSkipIce({ id: ADMIN, name: "Admin", user: "admin" })).toBe(false);
    // Neither side's next roster poll attaches the silent link again.
    member.reuse.considerRoster([{ id: ADMIN, name: "Admin", user: "admin" }], MEMBER);
    admin.reuse.considerRoster([{ id: MEMBER, name: "Member", user: "member" }], ADMIN);
    expect(admin.reuse.reusedLinkCount()).toBe(0);
    expect(member.reuse.reusedLinkCount()).toBe(0);
    expect(admin.reuse.shouldSkipIce({ id: MEMBER, name: "Member", user: "member" })).toBe(false);
    // The member's refused `open` goes unanswered, then it falls back to ICE.
    member.runTimers(COLLAB_REUSE_ACK_TIMEOUT_MS);
    expect(member.reuse.shouldSkipIce({ id: ADMIN, name: "Admin", user: "admin" })).toBe(false);
  });

  it("keeps a reused link that delivered a message", () => {
    const admin = browser("admin", ADMIN, "Admin");
    const member = browser("member", MEMBER, "Member");
    link(admin, member, { remotePrincipalId: "member-r1", localPrincipalId: "admin-r1" });
    link(member, admin, { remotePrincipalId: "admin-r1", localPrincipalId: "member-r1" });
    rosterBoth(admin, member);
    member.reuse.sendTo(ADMIN, syncMessage("step-1"));

    admin.runTimers(COLLAB_REUSE_SILENT_LINK_MS);

    expect(admin.fallbacks).toEqual([]);
    expect(admin.reuse.shouldSkipIce({ id: MEMBER, name: "Member", user: "member" })).toBe(true);
  });
});
