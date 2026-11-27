import { driveJmapSession, fetchDriveUser, resolveFileNodeId } from "@/lib/api/wgw/drive-jmap";

/**
 * Adds and removes tags on one file or folder (#2402): a delta, never a full list.
 * Resolves with the tags the node has now.
 */
export async function setFileNodeTags(
  path: string,
  delta: { tagsAdd?: string[]; tagsRemove?: string[] },
  opts: { signal?: AbortSignal } | undefined,
): Promise<string[]> {
  const session = await driveJmapSession();
  const user = await fetchDriveUser(opts);
  const nodeId = await resolveFileNodeId(session, path, user.username, opts?.signal);
  const response = await session.fileNodes.setFileNodes(
    { accountId: session.accountId, update: { [nodeId]: delta } },
    { signal: opts?.signal },
  );
  const tags = response.updated?.[nodeId]?.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}
