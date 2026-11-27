import { beforeEach, describe, expect, it, vi } from "vitest";
import { serverRefusalReason } from "@/lib/api/refusal-reason";
import { wgwFetch } from "@/lib/api/wgw/http";
import { listTaskLists } from "@/lib/api/wgw/tasks";
import { listNotebooks } from "@/lib/api/wgw/notes-vjournal";
import { listChatChannels } from "@/lib/api/wgw/meet-chat";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwFetchPrincipal: vi.fn(),
  wgwReadJson: vi.fn(),
  wgwSettingsStateRead: { read: vi.fn() },
}));
vi.mock("@/lib/offline/core/collection-check-now", () => ({
  cachedCollectionAudience: vi.fn(() => null),
  cachedItemAudience: vi.fn(() => null),
  checkNowAfterWrite: vi.fn(),
}));

const message = "Only a team admin can add a collection to a team.";

async function rejection(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("403 team_admin_only reaches serverRefusalReason", () => {
  beforeEach(() => {
    vi.mocked(wgwFetch).mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: message, code: "team_admin_only" }), { status: 403 }),
    );
  });

  it.each([
    ["tasks", () => listTaskLists()],
    ["notes", () => listNotebooks()],
    ["meet chat", () => listChatChannels()],
  ])("%s", async (_name, call) => {
    const error = await rejection(call);
    expect((error as { code?: string }).code).toBe("team_admin_only");
    expect(serverRefusalReason(error)).toBe(message);
  });
});
