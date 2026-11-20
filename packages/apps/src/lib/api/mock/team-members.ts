import type { TeamMember, TeamMemberCandidate, TeamMembersOperations } from "@/lib/api/wgw/teams";
import { TEAM_CANDIDATE_MIN_QUERY } from "@/lib/api/wgw/teams";
import { WgwRequestError } from "@/lib/api/wgw/request-error";

type Person = Omit<TeamMember, "isTeamAdmin">;

/** Everyone in the mock instance; the candidates search reads from here. */
export const MOCK_TEAM_DIRECTORY: Person[] = [
  { username: "demo.user", displayName: "Demo User", email: "demo@example.test" },
  { username: "ada", displayName: "Ada Lovelace", email: "ada@example.test" },
  { username: "grace", displayName: "Grace Hopper", email: "grace@example.test" },
  { username: "katherine", displayName: "Katherine Johnson", email: "katherine@example.test" },
  { username: "margaret", displayName: "Margaret Hamilton", email: "margaret@example.test" },
  { username: "radia", displayName: "Radia Perlman", email: "radia@example.test" },
  { username: "sophie", displayName: "Sophie Wilson", email: "sophie@example.test" },
];

export type MockTeamSeed = Record<string, { members: string[]; teamAdmins: string[] }>;

/** Matches the Teams of `createSettingsAppBootstrap`; the demo user runs editorial. */
export function mockTeamSeed(): MockTeamSeed {
  return {
    editorial: {
      members: ["demo.user", "ada", "grace", "katherine", "margaret", "radia"],
      teamAdmins: ["demo.user", "grace"],
    },
    studio: { members: ["demo.user", "margaret", "radia", "sophie"], teamAdmins: ["margaret"] },
  };
}

function notFound(method: string, path: string): WgwRequestError {
  return new WgwRequestError(`${method} ${path} failed (404): Team not found.`, 404);
}

/**
 * In-memory stand-in for `/api/v1/teams/{team}/…` with the server's rules: an unknown Team
 * or user is 404, only a member can be team admin (409), removing a member removes the role,
 * and a search needs two characters (400) and returns at most 20 people.
 */
export function createMockTeamMembersOperations(
  seed: MockTeamSeed = mockTeamSeed(),
  directory: Person[] = MOCK_TEAM_DIRECTORY,
): TeamMembersOperations {
  const teams = structuredClone(seed);
  const team = (slug: string, method: string, rest: string) => {
    const found = teams[slug];
    if (!found) throw notFound(method, `/teams/${slug}/${rest}`);
    return found;
  };
  const person = (username: string, method: string, path: string): Person => {
    const found = directory.find((entry) => entry.username === username);
    if (!found) throw new WgwRequestError(`${method} ${path} failed (404): User not found.`, 404);
    return found;
  };

  return {
    listMembers: async (slug) => {
      const { members, teamAdmins } = team(slug, "GET", "members");
      return directory
        .filter((entry) => members.includes(entry.username))
        .map((entry): TeamMember => ({
          ...entry,
          isTeamAdmin: teamAdmins.includes(entry.username),
        }));
    },
    searchCandidates: async (slug, query) => {
      const { members } = team(slug, "GET", "member-candidates");
      const needle = query.trim().toLowerCase();
      if (needle.length < TEAM_CANDIDATE_MIN_QUERY) {
        throw new WgwRequestError(
          `GET /teams/${slug}/member-candidates failed (400): q must be at least 2 characters.`,
          400,
        );
      }
      return directory
        .filter((entry) =>
          `${entry.username}\n${entry.displayName}\n${entry.email}`.toLowerCase().includes(needle),
        )
        .slice(0, 20)
        .map((entry): TeamMemberCandidate => ({
          ...entry,
          isMember: members.includes(entry.username),
        }));
    },
    addMember: async (slug, username) => {
      const found = team(slug, "PUT", `members/${username}`);
      person(username, "PUT", `/teams/${slug}/members/${username}`);
      if (!found.members.includes(username)) found.members.push(username);
    },
    removeMember: async (slug, username) => {
      const found = team(slug, "DELETE", `members/${username}`);
      found.members = found.members.filter((entry) => entry !== username);
      found.teamAdmins = found.teamAdmins.filter((entry) => entry !== username);
    },
    appointTeamAdmin: async (slug, username) => {
      const found = team(slug, "PUT", `admins/${username}`);
      person(username, "PUT", `/teams/${slug}/admins/${username}`);
      if (!found.members.includes(username)) {
        throw new WgwRequestError(
          `PUT /teams/${slug}/admins/${username} failed (409): Only a member of the team can be its team admin.`,
          409,
        );
      }
      if (!found.teamAdmins.includes(username)) found.teamAdmins.push(username);
    },
    dismissTeamAdmin: async (slug, username) => {
      const found = team(slug, "DELETE", `admins/${username}`);
      found.teamAdmins = found.teamAdmins.filter((entry) => entry !== username);
    },
  };
}
