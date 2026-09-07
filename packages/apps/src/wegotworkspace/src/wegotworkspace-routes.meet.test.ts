import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

const here = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(here, "wegotworkspace-routes.tsx"), "utf8");

describe("wegotworkspace meet invite routes", () => {
  it("rewrites leftover ?room= onto /meet/meetings/{id}", () => {
    expect(routesSource).toContain("MEET_MEETINGS_ROUTE");
    expect(routesSource).toContain("meetSearchWithoutRoom");
    expect(routesSource).toMatch(/params: \{ meetingId: room/);
  });

  it("matches /meet/meetings/:meetingId", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/meetings/h8y8-ewp6-al8n"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();
    expect(router.state.location.pathname).toBe("/meet/meetings/h8y8-ewp6-al8n");
    const match = router.state.matches.find((row) => matchHasParam(row.params, "meetingId"));
    expect(match?.params).toMatchObject({ meetingId: "h8y8-ewp6-al8n" });
  });

  it("redirects /meet/guest and /meet/join onto /meet/meetings/{id} when room is set", () => {
    expect(routesSource).toContain("to: MEET_MEETINGS_ROUTE");
    expect(routesSource).toMatch(/path: "\/meet\/guest"/);
    expect(routesSource).toMatch(/path: "\/meet\/join"/);
  });

  it("keeps persisted /meet/meetings/{slug} in the workspace, not the invite gate", () => {
    expect(routesSource).toContain("meetIsAdHocMeetingId");
    expect(routesSource).toContain("persistedMeetingId");
    expect(routesSource).toMatch(/adHocMeeting \|\| \(!onConversationRoute && inviteRoom\)/);
    expect(routesSource).toContain("channelId ?? persistedMeetingId");
  });

  it("uses MeetInviteGate on /meet and only redirects old guest/join paths", () => {
    expect(routesSource).toContain('path: "/meet/join"');
    expect(routesSource).toContain('path: "/meet/guest"');
    expect(routesSource).toContain("MeetInviteGate");
    expect(routesSource).toContain("MeetLiveRoute");
    expect(routesSource).toMatch(/path: "\/meet\/guest"[\s\S]*throw redirect/);
    expect(routesSource).toMatch(/path: "\/meet\/join"[\s\S]*throw redirect/);
    expect(routesSource).not.toContain("MeetGuestRoute");
    expect(routesSource).not.toContain("component: MeetGuestRoute");
  });
});

describe("wegotworkspace meet conversation routes", () => {
  it("matches channelId on /meet/channels/:channelId", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/channels/design-reviews"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/meet/channels/design-reviews");
    const match = router.state.matches.find((row) => matchHasParam(row.params, "channelId"));
    expect(match?.params).toMatchObject({ channelId: "design-reviews" });
  });

  it("matches peerId on /meet/dms/:peerId without a dm: prefix", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/dms/ada.lovelace"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/meet/dms/ada.lovelace");
    const match = router.state.matches.find((row) => matchHasParam(row.params, "peerId"));
    expect(match?.params).toMatchObject({ peerId: "ada.lovelace" });
  });

  it("navigates between channel and dm paths without leaving /meet", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/channels/general"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    await router.navigate({
      to: "/meet/dms/$peerId",
      params: { peerId: "alice" },
    });
    expect(router.state.location.pathname).toBe("/meet/dms/alice");

    await router.navigate({
      to: "/meet/channels/$channelId",
      params: { channelId: "general" },
    });
    expect(router.state.location.pathname).toBe("/meet/channels/general");
  });

  it("matches legacy /meet/{id} so MeetChatApp can replace onto nested paths", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/chat-general"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/meet/chat-general");
    const match = router.state.matches.find((row) => matchHasParam(row.params, "legacyId"));
    expect(match?.params).toMatchObject({ legacyId: "chat-general" });
  });
});

function matchHasParam(params: Record<string, unknown>, key: string): boolean {
  return typeof params[key] === "string";
}
