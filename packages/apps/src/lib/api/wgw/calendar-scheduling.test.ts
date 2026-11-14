import { beforeEach, describe, expect, it, vi } from "vitest";

const { wgwFetch, wgwReadJson } = vi.hoisted(() => ({
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

vi.mock("@/lib/api/wgw/http", () => ({ wgwFetch, wgwReadJson }));

import {
  CalendarSchedulingGoneError,
  dismissCalendarSchedulingNotification,
  respondCalendarSchedulingNotification,
} from "@/lib/api/wgw/calendar-scheduling";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";

describe("calendar scheduling failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an RSVP the server refuses carries the status, with the same message", async () => {
    wgwFetch.mockResolvedValueOnce(new Response("no", { status: 403 }));

    const error = await respondCalendarSchedulingNotification("n1", "accepted").catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(WgwRequestError);
    expect(error).toMatchObject({ status: 403, message: "Could not send RSVP" });
    // The outbox now sees a 403 and stops retrying it (#1646).
    expect(httpStatusFromFlushError(error)).toBe(403);
  });

  it("a dismiss the server cannot do carries the status", async () => {
    wgwFetch.mockResolvedValueOnce(new Response("down", { status: 503 }));

    await expect(dismissCalendarSchedulingNotification("n1")).rejects.toMatchObject({
      status: 503,
      message: "Could not dismiss invitation",
    });
  });

  it("a cancelled invitation is still CalendarSchedulingGoneError", async () => {
    wgwFetch.mockResolvedValueOnce(new Response("gone", { status: 410 }));

    await expect(respondCalendarSchedulingNotification("n1", "declined")).rejects.toBeInstanceOf(
      CalendarSchedulingGoneError,
    );
  });
});
