import { migrateDocsAvailabilityPath } from "@/lib/offline/docs/docs-availability-store";
import { migrateDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import { migrateDriveContentBlobPath } from "@/lib/offline/drive/drive-content-sync";

/** Parking prefix for sidecars between the two phases. No real path starts with a dot. */
const PARKING_PREFIX = ".wgw-moving";

function bare(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

/**
 * Pins and blobs of a node follow its new path. The collab database does not
 * move: Docs keys it on the FileNode id, which a rename keeps.
 */
export async function migrateNodeSidecars(
  username: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  if (bare(oldPath) === bare(newPath)) return;
  await migrateDocsAvailabilityPath(username, oldPath, newPath);
  await migrateDriveAvailabilityPath(username, oldPath, newPath);
  await migrateDriveContentBlobPath(username, oldPath, newPath);
}

/**
 * Collects the sidecar moves (blob, pins) of one sync and runs them in two
 * phases: every source is parked first, then every parked set goes to its
 * target. Sources are paths as they were before the sync, so a rename onto a
 * path another moving node still holds (a swap, a chain) never overwrites that
 * node's blob. The first move from a path wins.
 */
export class SidecarMoves {
  private readonly moves: Array<{ from: string; to: string }> = [];

  add(from: string, to: string): void {
    const source = bare(from);
    const target = bare(to);
    if (source === target) return;
    if (this.moves.some((move) => move.from === source)) return;
    this.moves.push({ from: source, to: target });
  }

  async apply(username: string): Promise<void> {
    const pending = this.moves.filter((move) => move.from !== move.to);
    this.moves.length = 0;
    // Unique per run: two tabs may apply changes at the same time.
    const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const parked = pending.map((move, index) => ({
      parking: `${PARKING_PREFIX}/${run}/${index}`,
      to: move.to,
    }));
    for (let index = 0; index < pending.length; index += 1) {
      await migrateNodeSidecars(username, pending[index]!.from, parked[index]!.parking);
    }
    for (const { parking, to } of parked) {
      await migrateNodeSidecars(username, parking, to);
    }
  }
}
