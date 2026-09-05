import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

const here = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(here, "wegotworkspace-routes.tsx"), "utf8");

describe("wegotworkspace meet invite routes", () => {
  it("matches /meet/join and /meet/guest with a room query", async () => {
    for (const [pathname, search] of [
      ["/meet/join", { room: "h8y8-ewp6-al8n" }],
      ["/meet/guest", { room: "h8y8-ewp6-al8n" }],
    ] as const) {
      const history = createMemoryHistory({
        initialEntries: [`${pathname}?room=h8y8-ewp6-al8n`],
      });
      const router = createWeGotWorkspaceRouter({ mode: "mock", history });
      await router.load();
      expect(router.state.location.pathname).toBe(pathname);
      expect(router.state.location.search).toMatchObject(search);
    }
  });

  it("uses authenticated MeetApp on /meet/join and upgrades /meet/guest when the principal can manage", () => {
    expect(routesSource).toContain('path: "/meet/join"');
    expect(routesSource).toContain("withWeGotWorkspaceAuth(MeetApp)");
    expect(routesSource).toContain("createWgwMeetGuestOrHostApiSource");
    expect(routesSource).not.toContain("createWgwMeetGuestApiSource()");
  });
});

describe("wegotworkspace meet conversation routes", () => {
  it("matches channelId on /meet/channels/:channelId", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/meet/channels/chat-design-reviews"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    expect(router.state.location.pathname).toBe("/meet/channels/chat-design-reviews");
    const match = router.state.matches.find((row) => matchHasParam(row.params, "channelId"));
    expect(match?.params).toMatchObject({ channelId: "chat-design-reviews" });
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
      initialEntries: ["/meet/channels/chat-general"],
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
      params: { channelId: "chat-general" },
    });
    expect(router.state.location.pathname).toBe("/meet/channels/chat-general");
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
