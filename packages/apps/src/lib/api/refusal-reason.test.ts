import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/api-error";
import { serverRefusalReason, withRefusalReason } from "@/lib/api/refusal-reason";
import { JmapSetItemError } from "@/lib/jmap-client";

const teamAdminOnly = "Only a team admin can add a collection to a team.";

describe("serverRefusalReason", () => {
  it("reads the reason from a forbidden JMAP set error", () => {
    const error = new JmapSetItemError("create", "create-1", {
      type: "forbidden",
      description: teamAdminOnly,
    });
    expect(serverRefusalReason(error)).toBe(teamAdminOnly);
  });

  it("reads the reason from a 403 API error", () => {
    expect(serverRefusalReason(new ApiError("x", 403, "team_admin_only", teamAdminOnly))).toBe(
      teamAdminOnly,
    );
  });

  it("gives nothing for other failures", () => {
    expect(
      serverRefusalReason(new JmapSetItemError("create", "c", { type: "serverFail" })),
    ).toBeNull();
    expect(serverRefusalReason(new ApiError("x", 500, undefined, "boom"))).toBeNull();
    expect(serverRefusalReason(new ApiError("x", 403))).toBeNull();
    expect(serverRefusalReason(new Error("offline"))).toBeNull();
  });

  it("appends the reason to the generic toast", () => {
    const refused = new ApiError("x", 403, "team_admin_only", teamAdminOnly);
    expect(withRefusalReason("Could not subscribe to calendar", refused)).toBe(
      `Could not subscribe to calendar. ${teamAdminOnly}`,
    );
    expect(withRefusalReason("Could not save.", refused)).toBe(`Could not save. ${teamAdminOnly}`);
    expect(withRefusalReason("Could not save", new Error("offline"))).toBe("Could not save");
  });
});
