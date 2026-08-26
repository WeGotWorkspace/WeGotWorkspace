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
