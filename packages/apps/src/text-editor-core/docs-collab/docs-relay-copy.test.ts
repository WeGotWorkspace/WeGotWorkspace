import { describe, expect, it } from "vitest";
import { docsRelayCopy } from "./docs-relay-copy";

describe("docs relay copy", () => {
  it("shows the admin the slower-path banner and Set up", () => {
    const copy = docsRelayCopy({
      role: "admin",
      outcome: "relay_unavailable",
      name: "Ada",
    });
    expect(copy?.message).toBe(
      "Collaboration with Ada runs via the server (slower). A TURN server makes it faster.",
    );
    expect(copy?.setupHref).toBe("/admin/collaboration");
  });

  it("hides Set up from everyone who is not an admin", () => {
    expect(docsRelayCopy({ role: "user", outcome: "relay_unavailable", name: "Ada" })).toBeNull();
    expect(docsRelayCopy({ role: "guest", outcome: "relay_unavailable", name: "Ada" })).toBeNull();
  });

  it("does not mention joining, and stays quiet unless relay is unavailable", () => {
    const copy = docsRelayCopy({
      role: "admin",
      outcome: "relay_unavailable",
      name: "Ada",
    });
    expect(copy?.message.toLowerCase()).not.toContain("can't join");
    expect(copy?.message.toLowerCase()).not.toContain("cannot join");
    expect(docsRelayCopy({ role: "admin", outcome: "issued", name: "Ada" })).toBeNull();
    expect(docsRelayCopy({ role: "admin", outcome: null, name: "Ada" })).toBeNull();
  });
});
