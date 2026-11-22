import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import {
  wgwErrorMessageFromBody,
  wgwFetch,
  wgwLiveApiEnabled,
  wgwReadJson,
} from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

/** An archived, non-default Project of any Team (GET /admin/projects). */
export type AdminArchivedProject = {
  id: string;
  teamSlug: string;
  teamName: string;
  name: string;
  color: string | null;
  archivedAt: string | null;
};

/** Deleting an archived Project for good is an organization-admin action (#810). */
export type AdminProjectOperations = {
  listArchived: (opts?: { signal?: AbortSignal }) => Promise<AdminArchivedProject[]>;
  /** Rejects with a `WgwRequestError` carrying the HTTP status and the server's message. */
  purge: (id: string, opts?: { signal?: AbortSignal }) => Promise<void>;
};

async function failure(res: Response, label: string): Promise<WgwRequestError> {
  const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
  return new WgwRequestError(`${label} failed (${res.status}): ${detail}`, res.status);
}

export function createWgwAdminProjectOperations(): AdminProjectOperations {
  return {
    listArchived: async (opts) => {
      const res = await wgwFetch("/admin/projects", { signal: opts?.signal });
      if (!res.ok) throw await failure(res, "GET /admin/projects");
      return ((await wgwReadJson(res)) as { list: AdminArchivedProject[] }).list;
    },
    purge: async (id, opts) => {
      const res = await wgwFetch(`/admin/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: opts?.signal,
      });
      if (!res.ok) throw await failure(res, "DELETE /admin/projects");
    },
  };
}

/** Same ordering as the API: by Team name, then Project name. */
function sortedArchived(projects: readonly AdminArchivedProject[]): AdminArchivedProject[] {
  return [...projects].sort(
    (a, b) => a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name),
  );
}

export const MOCK_ARCHIVED_PROJECTS: readonly AdminArchivedProject[] = [
  {
    id: "p-site",
    teamSlug: "studio",
    teamName: "Studio",
    name: "Website relaunch",
    color: "#2f6fed",
    archivedAt: "2026-10-12T09:30:00Z",
  },
  {
    id: "p-brand",
    teamSlug: "studio",
    teamName: "Studio",
    name: "Brand refresh",
    color: null,
    archivedAt: "2026-09-03T14:00:00Z",
  },
  {
    id: "p-audit",
    teamSlug: "finance",
    teamName: "Finance",
    name: "Audit 2025",
    color: "#c2410c",
    archivedAt: "2026-02-20T08:00:00Z",
  },
];

export function createMockAdminProjectOperations(
  seed: readonly AdminArchivedProject[] = MOCK_ARCHIVED_PROJECTS,
): AdminProjectOperations {
  let projects = [...seed];
  return {
    listArchived: () => Promise.resolve(sortedArchived(projects)),
    purge: (id) => {
      if (!projects.some((project) => project.id === id)) {
        return Promise.reject(new WgwRequestError("DELETE /admin/projects failed (404)", 404));
      }
      projects = projects.filter((project) => project.id !== id);
      return Promise.resolve();
    },
  };
}

export function createDefaultAdminProjectOperations(): AdminProjectOperations {
  return createWorkspaceSource<AdminProjectOperations>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: mocksInBuild ? () => createMockAdminProjectOperations() : mocksNotInBuild,
    createLiveSource: createWgwAdminProjectOperations,
  });
}
