import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchAdminLiveBootstrap } from "@/lib/api/wgw/admin";
import { wgwFetch, wgwFetchPrincipal, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwSessionRenewalError } from "@/lib/api/wgw/session-renewal-error";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwFetch: vi.fn(),
  wgwFetchPrincipal: vi.fn(),
  wgwReadJson: vi.fn(),
}));

const fetchMock = vi.mocked(wgwFetch);
const principalMock = vi.mocked(wgwFetchPrincipal);

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Runs the bootstrap to its end, retries included, and returns what it threw. */
async function bootstrapFailure(): Promise<unknown> {
  const outcome = fetchAdminLiveBootstrap().then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(10_000);
  return outcome;
}

function adminStateCalls(): number {
  return fetchMock.mock.calls.filter(([path]) => path === "/admin/state").length;
}

describe("fetchAdminLiveBootstrap retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(wgwReadJson).mockResolvedValue({ lines: [] });
    principalMock.mockResolvedValue({
      user: { username: "admin", displayName: "Admin", email: "" },
    } as Awaited<ReturnType<typeof wgwFetchPrincipal>>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("retries while the admin state answers 503", async () => {
    let stateAttempts = 0;
    fetchMock.mockImplementation(async (path) => {
      if (path !== "/admin/state") return new Response("{}", { status: 200 });
      stateAttempts += 1;
      return new Response("", { status: stateAttempts === 1 ? 503 : 500 });
    });

    const error = await bootstrapFailure();

    expect(adminStateCalls()).toBe(2);
    expect(error).toMatchObject({ message: "GET /admin/state failed (500)" });
  });

  it("does not retry another status", async () => {
    fetchMock.mockImplementation(async (path) =>
      path === "/admin/state"
        ? new Response("", { status: 500 })
        : new Response("{}", { status: 200 }),
    );

    await bootstrapFailure();

    expect(adminStateCalls()).toBe(1);
  });

  it("retries on status 503 when the text does not name it", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    // A session renewal that hit a 5xx: status 503, and a sentence for the user.
    principalMock
      .mockRejectedValueOnce(new WgwSessionRenewalError())
      .mockRejectedValueOnce(statusError("Unauthorized", 401));

    const error = await bootstrapFailure();

    expect(principalMock).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ message: "Unauthorized" });
  });

  it("does not retry when only the text mentions 503", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    principalMock.mockRejectedValue(statusError("Upstream said HTTP 503", 502));

    await bootstrapFailure();

    expect(principalMock).toHaveBeenCalledTimes(1);
  });
});
