import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

import { wgwFetch } from "@/lib/api/wgw/http";
import { subscribePush } from "./notifications";

describe("subscribePush", () => {
  beforeEach(() => {
    vi.mocked(wgwFetch).mockReset();
    vi.mocked(wgwFetch).mockResolvedValue(new Response("{}", { status: 201 }));
  });

  it("sends the app scope with the endpoint and keys", async () => {
    await subscribePush(
      { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } },
      "/docs",
    );

    const [path, init] = vi.mocked(wgwFetch).mock.calls[0] ?? [];
    expect(path).toBe("/notifications/push/subscriptions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      endpoint: "https://push.example/1",
      keys: { p256dh: "a", auth: "b" },
      scope: "/docs",
    });
  });

  it("throws when the server refuses the subscription", async () => {
    vi.mocked(wgwFetch).mockResolvedValue(new Response("{}", { status: 422 }));

    await expect(
      subscribePush({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }, "/"),
    ).rejects.toThrow("422");
  });
});
