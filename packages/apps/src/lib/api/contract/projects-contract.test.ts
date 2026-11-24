import { describe, expect, it, expectTypeOf, vi } from "vitest";
import type { Project, ProjectListResponse } from "@wgw/openapi-types/projects-types";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { createWgwProjectOperations } from "@/lib/api/wgw/projects";
import type { WorkspaceProject } from "@/lib/projects/projects-store";

const wgwFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetch,
}));

/** Minimal OpenAPI-shaped Project: every field the API sends. */
const apiProject = {
  id: "01hzzzzzzzzzzzzzzzzzzzzzzz",
  teamSlug: "design",
  slug: "website",
  name: "Website",
  color: "#3b82f6",
  isDefault: false,
  archived: false,
  archivedAt: null,
  mayManage: true,
  resources: {
    calendarId: "1",
    taskListId: "2",
    notebookId: "3",
    channelId: "4",
    driveFolderId: "5",
    driveFolderPath: "groups/design/Website",
  },
} satisfies Project;

describe("Projects UI ↔ OpenAPI contract", () => {
  it("the workspace Project is the API Project plus the Team name", () => {
    expectTypeOf<WorkspaceProject>().toEqualTypeOf<Project & { teamName: string }>();
  });

  it("the list answer is the API's list response", () => {
    expectTypeOf<
      Awaited<ReturnType<ReturnType<typeof createWgwProjectOperations>["list"]>>
    >().toEqualTypeOf<ProjectListResponse["list"]>();
  });

  it("the live client hands the API rows over unchanged", async () => {
    wgwFetch.mockResolvedValue(
      new Response(JSON.stringify({ list: [apiProject] satisfies ProjectListResponse["list"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(await createWgwProjectOperations().list()).toEqual([apiProject]);
  });

  it("the mock source sends the same fields as the API", async () => {
    const [row] = await createMockProjectOperations().list();
    expect(Object.keys(row ?? {}).sort()).toEqual(Object.keys(apiProject).sort());
    expect(Object.keys(row?.resources ?? {}).sort()).toEqual(
      Object.keys(apiProject.resources).sort(),
    );
  });
});
