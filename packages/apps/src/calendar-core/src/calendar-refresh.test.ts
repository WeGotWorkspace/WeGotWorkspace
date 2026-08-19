import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CALENDAR_BACKGROUND_POLL_MS } from "@/calendar-core/src/calendar-refresh";

const here = dirname(fileURLToPath(import.meta.url));

describe("CALENDAR_BACKGROUND_POLL_MS", () => {
  it("is 15 seconds and drives calendar bootstrap, surface, and invitation polls", () => {
    expect(CALENDAR_BACKGROUND_POLL_MS).toBe(15_000);
    const api = readFileSync(join(here, "use-calendar-api.ts"), "utf8");
    const surface = readFileSync(join(here, "use-calendar-surface.ts"), "utf8");
    const invitations = readFileSync(join(here, "use-calendar-invitations.ts"), "utf8");
    expect(api).toContain("CALENDAR_BACKGROUND_POLL_MS");
    expect(surface).toContain("CALENDAR_BACKGROUND_POLL_MS");
    expect(invitations).toContain("CALENDAR_BACKGROUND_POLL_MS");
  });
});
