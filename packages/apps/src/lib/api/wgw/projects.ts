import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type {
  Project,
  ProjectCreateRequest,
  ProjectListResponse,
  ProjectPatchRequest,
} from "@wgw/openapi-types/projects-types";

/** A Team the caller is in, as the Projects UI needs it: its slug, name and the caller's role. */
export type ProjectTeam = {
  slug: string;
  displayName: string;
  isTeamAdmin: boolean;
};

export type ProjectTeamsResult = { username: string; teams: ProjectTeam[] };

/**
 * Projects of the caller's Teams (#817, #819). Members read; team admins create, rename,
 * archive, restore and delete for good. Every failure is a `WgwRequestError` with the HTTP status.
 */
export type ProjectOperations = {
  list: (opts?: { archived?: boolean }) => Promise<Project[]>;
  /** The caller and their Teams, with names: the Projects API only carries the Team slug. */
  listTeams: () => Promise<ProjectTeamsResult>;
  create: (request: ProjectCreateRequest) => Promise<Project>;
  patch: (id: string, patch: ProjectPatchRequest) => Promise<Project>;
  archive: (id: string) => Promise<Project>;
  unarchive: (id: string) => Promise<Project>;
  /** Deletes an archived Project for good (a team admin of its Team). */
  purge: (id: string) => Promise<void>;
};

async function readOk(res: Response, label: string): Promise<unknown> {
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new WgwRequestError(`${label} failed (${res.status}): ${detail}`, res.status);
  }
  return wgwReadJson(res);
}

function jsonInit(method: string, body?: object): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

type SettingsStateGroups = {
  user?: { username?: string };
  groups?: { id: string; displayName: string; isTeamAdmin?: boolean }[];
};

/** `principals/groups/{slug}` → `{slug}`; the Projects API names Teams by slug. */
function slugOfGroupUri(uri: string): string {
  const trimmed = uri.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function createWgwProjectOperations(): ProjectOperations {
  const project = async (path: string, init: RequestInit, label: string) =>
    (await readOk(await wgwFetch(path, init), label)) as Project;

  return {
    list: async (opts) => {
      const path = opts?.archived ? "/projects?archived=1" : "/projects";
      const body = (await readOk(await wgwFetch(path), `GET ${path}`)) as ProjectListResponse;
      return body.list;
    },
    listTeams: async () => {
      const body = (await readOk(
        await wgwFetch("/settings/state"),
        "GET /settings/state",
      )) as SettingsStateGroups;
      return {
        username: body.user?.username ?? "",
        teams: (body.groups ?? []).map((group) => ({
          slug: slugOfGroupUri(group.id),
          displayName: group.displayName,
          isTeamAdmin: group.isTeamAdmin === true,
        })),
      };
    },
    create: (request) => project("/projects", jsonInit("POST", request), "POST /projects"),
    patch: (id, patch) =>
      project(`/projects/${encodeURIComponent(id)}`, jsonInit("PATCH", patch), "PATCH /projects"),
    archive: (id) =>
      project(`/projects/${encodeURIComponent(id)}/archive`, jsonInit("POST"), "Archive project"),
    unarchive: (id) =>
      project(`/projects/${encodeURIComponent(id)}/unarchive`, jsonInit("POST"), "Restore project"),
    purge: async (id) => {
      await readOk(
        await wgwFetch(`/projects/${encodeURIComponent(id)}`, jsonInit("DELETE")),
        "Delete project",
      );
    },
  };
}
