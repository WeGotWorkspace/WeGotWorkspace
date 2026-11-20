import { wgwErrorMessageFromBody, wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { components } from "@wgw/openapi-types/openapi-types";

/**
 * Member management of one Team (#2278), for a team admin of it or an organization admin.
 * Read fresh when the dialog opens: no push, no cache. Errors carry the HTTP status; a Team
 * the caller may not manage answers 404, like an unknown Team.
 */
export type TeamMember = components["schemas"]["TeamMember"];
export type TeamMemberCandidate = components["schemas"]["TeamMemberCandidate"];

export type TeamMembersOperations = {
  listMembers: (teamSlug: string) => Promise<TeamMember[]>;
  /** Users whose name, username or email contains `query` (two characters or more). */
  searchCandidates: (teamSlug: string, query: string) => Promise<TeamMemberCandidate[]>;
  addMember: (teamSlug: string, username: string) => Promise<void>;
  removeMember: (teamSlug: string, username: string) => Promise<void>;
  appointTeamAdmin: (teamSlug: string, username: string) => Promise<void>;
  dismissTeamAdmin: (teamSlug: string, username: string) => Promise<void>;
};

export const TEAM_CANDIDATE_MIN_QUERY = 2;

function teamPath(teamSlug: string, rest: string): string {
  return `/teams/${encodeURIComponent(teamSlug)}/${rest}`;
}

async function request(method: "GET" | "PUT" | "DELETE", path: string): Promise<unknown> {
  const res = await wgwFetch(path, { method });
  if (!res.ok) {
    const detail = wgwErrorMessageFromBody(await res.text(), res.status, res.statusText);
    throw new WgwRequestError(`${method} ${path} failed (${res.status}): ${detail}`, res.status);
  }
  return wgwReadJson(res);
}

async function write(method: "PUT" | "DELETE", path: string): Promise<void> {
  await request(method, path);
}

export function createWgwTeamMembersOperations(): TeamMembersOperations {
  return {
    listMembers: async (teamSlug) =>
      ((await request("GET", teamPath(teamSlug, "members"))) as { list: TeamMember[] }).list,
    searchCandidates: async (teamSlug, query) =>
      (
        (await request(
          "GET",
          teamPath(teamSlug, `member-candidates?q=${encodeURIComponent(query)}`),
        )) as { list: TeamMemberCandidate[] }
      ).list,
    addMember: (teamSlug, username) =>
      write("PUT", teamPath(teamSlug, `members/${encodeURIComponent(username)}`)),
    removeMember: (teamSlug, username) =>
      write("DELETE", teamPath(teamSlug, `members/${encodeURIComponent(username)}`)),
    appointTeamAdmin: (teamSlug, username) =>
      write("PUT", teamPath(teamSlug, `admins/${encodeURIComponent(username)}`)),
    dismissTeamAdmin: (teamSlug, username) =>
      write("DELETE", teamPath(teamSlug, `admins/${encodeURIComponent(username)}`)),
  };
}
