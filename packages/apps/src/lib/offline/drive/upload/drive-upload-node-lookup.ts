import type { DriveJmapSession } from "@/lib/api/wgw/drive-jmap";
import type { JmapFileNode } from "@/lib/jmap-client";

/** The child of `folderId` named `name` (case-insensitive match first), or null. */
export async function existingByName(
  session: DriveJmapSession,
  input: { folderId: string },
  name: string,
  signal?: AbortSignal,
): Promise<JmapFileNode | null> {
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: input.folderId, name },
    { signal },
  );
  return (
    got.list.find((node) => node.name.toLowerCase() === name.toLowerCase()) ?? got.list[0] ?? null
  );
}

/** Names of every child of `folderId`, files and folders. */
export async function childNames(
  session: DriveJmapSession,
  folderId: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const got = await session.fileNodes.queryAndGetFileNodes(
    session.accountId,
    { parentId: folderId },
    { signal },
  );
  return new Set(got.list.map((node) => node.name));
}
