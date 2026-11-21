import { type WorkspaceSession, workspaceUserInitials } from "@/lib/workspace/workspace-session";

/**
 * The signed-in member as the apps show them: `/me` is the base, and the
 * `user` of `/settings/state` (when it could be read) wins so every app agrees
 * with Settings.
 */
export function workspaceSessionFromAccountReads(
  me: Record<string, unknown>,
  settingsState?: Record<string, unknown>,
): WorkspaceSession {
  const meUsername = typeof me.username === "string" ? me.username : "User";
  const candidate =
    settingsState?.user && typeof settingsState.user === "object"
      ? (settingsState.user as Record<string, unknown>)
      : undefined;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const settingsUser = candidate && {
    username: text(candidate.username),
    displayName: text(candidate.displayName),
    email: text(candidate.email),
  };

  const username = settingsUser?.username?.trim() || meUsername;
  const explicitDisplayName =
    settingsUser?.displayName ?? text(me.displayName) ?? text(me.displayname) ?? text(me.name);
  const displayName =
    explicitDisplayName?.trim() ||
    username
      .trim()
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ||
    "User";
  return {
    user: {
      displayName,
      initials: workspaceUserInitials({ displayName }),
      username,
      email: settingsUser?.email ?? text(me.email),
    },
    viewerInboxLabel: "me",
  };
}
