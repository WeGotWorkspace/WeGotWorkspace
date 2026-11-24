import { afterEach, describe, expect, it, vi } from "vitest";
import { createWgwProjectOperations } from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

const wgwFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => wgwFetch.mockReset());

describe("createWgwProjectOperations", () => {
  it("lists active or archived Projects", async () => {
    wgwFetch.mockImplementation(async () => json({ list: [{ id: "p1" }] }));
    const operations = createWgwProjectOperations();
    expect(await operations.list()).toEqual([{ id: "p1" }]);
    await operations.list({ archived: true });
    expect(wgwFetch.mock.calls.map((call) => call[0])).toEqual([
      "/projects",
      "/projects?archived=1",
    ]);
  });

  it("reads Team slugs, names and role from the settings state", async () => {
    wgwFetch.mockImplementation(async () =>
      json({
        user: { username: "ada" },
        groups: [
          { id: "principals/groups/design", displayName: "Design", isTeamAdmin: true },
          { id: "principals/groups/sales/", displayName: "Sales" },
        ],
      }),
    );
    expect(await createWgwProjectOperations().listTeams()).toEqual({
      username: "ada",
      teams: [
        { slug: "design", displayName: "Design", isTeamAdmin: true },
        { slug: "sales", displayName: "Sales", isTeamAdmin: false },
      ],
    });
  });

  it("posts a create and patches by id", async () => {
    wgwFetch.mockImplementation(async () => json({ id: "p1" }, 201));
    const operations = createWgwProjectOperations();
    await operations.create({ teamSlug: "design", name: "Brand" });
    await operations.patch("p1", { name: "Brand book" });
    await operations.archive("p1");
    await operations.unarchive("p1");
    await operations.purge("p1");
    const [create, patch, archive, unarchive, purge] = wgwFetch.mock.calls;
    expect(create?.[0]).toBe("/projects");
    expect(create?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ teamSlug: "design", name: "Brand" }),
    });
    expect(patch?.[0]).toBe("/projects/p1");
    expect(patch?.[1]).toMatchObject({ method: "PATCH" });
    expect(archive?.[0]).toBe("/projects/p1/archive");
    expect(unarchive?.[0]).toBe("/projects/p1/unarchive");
    expect(purge?.[0]).toBe("/projects/p1");
    expect(purge?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("turns every failure into a WgwRequestError with the status", async () => {
    wgwFetch.mockImplementation(async () => json({ error: "Only a team admin can do this" }, 403));
    const failure = await createWgwProjectOperations()
      .archive("p1")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WgwRequestError);
    expect((failure as WgwRequestError).status).toBe(403);
  });
});
