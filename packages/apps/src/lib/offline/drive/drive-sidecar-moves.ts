import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { docsAvailabilityTable } from "@/lib/offline/docs/docs-schema";
import { migrateDocsAvailabilityPath } from "@/lib/offline/docs/docs-availability-store";
import { migrateDriveAvailabilityPath } from "@/lib/offline/drive/drive-availability-store";
import { migrateDriveContentBlobPath } from "@/lib/offline/drive/drive-content-sync";
import { driveAvailabilityTable, driveContentBlobsTable } from "@/lib/offline/drive/drive-schema";

/** Parking prefix for sidecars between the two phases. No real path starts with a dot. */
/** Meta keys of the moves a sync has queued but not yet applied. */
const JOURNAL_PREFIX = "drive:sidecar-journal:";

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
 * phases inside one transaction: every source is parked first, then every
 * parked set goes to its target. Sources are paths as they were before the
 * sync, so a rename onto a path another moving node still holds (a swap, a
 * chain) never overwrites that node's blob. The first move from a path wins.
 *
 * The cache rows move before the sidecars do, so a stop in between would leave
 * every row at its final path and nothing to queue on the replay. `persist`
 * journals the moves first; `apply` clears the journal in the same transaction
 * as the moves, and {@link SidecarMoves.recover} applies what a stop left.
 */
export class SidecarMoves {
  private readonly moves: Array<{ from: string; to: string }> = [];
  private persisted = 0;
  private readonly run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  add(from: string, to: string): void {
    const source = bare(from);
    const target = bare(to);
    if (source === target) return;
    if (this.moves.some((move) => move.from === source)) return;
    this.moves.push({ from: source, to: target });
  }

  /** Journals the moves added since the last call. Call it before the rows move. */
  async persist(username: string): Promise<void> {
    if (this.persisted >= this.moves.length) return;
    const db = accountDb(username);
    const rows = this.moves.slice(this.persisted).map((move, offset) => ({
      key: `${JOURNAL_PREFIX}${this.run}/${String(this.persisted + offset).padStart(8, "0")}`,
      value: JSON.stringify(move),
    }));
    await db.meta.bulkPut(rows);
    this.persisted = this.moves.length;
  }

  /** Drops a move whose node was not placed after all (its row stays where it is). A journaled entry stays until `apply` clears it. */
  drop(from: string): void {
    const source = bare(from);
    const index = this.moves.findIndex((move) => move.from === source);
    if (index < 0) return;
    this.moves.splice(index, 1);
    if (index < this.persisted) this.persisted -= 1;
  }

  async apply(username: string): Promise<void> {
    const pending = this.moves.filter((move) => move.from !== move.to);
    this.moves.length = 0;
    this.persisted = 0;
    await runMoves(username, pending, `${JOURNAL_PREFIX}${this.run}/`);
  }

  /** Applies the journals of runs that stopped before `apply` finished. */
  static async recover(username: string): Promise<void> {
    const rows = await accountDb(username).meta.where("key").startsWith(JOURNAL_PREFIX).toArray();
    const runs = new Map<string, Array<{ from: string; to: string }>>();
    for (const row of rows) {
      const run = row.key.slice(0, row.key.lastIndexOf("/") + 1);
      try {
        const list = runs.get(run) ?? [];
        list.push(JSON.parse(row.value) as { from: string; to: string });
        runs.set(run, list);
      } catch {
        runs.set(run, runs.get(run) ?? []);
      }
    }
    for (const [prefix, moves] of runs) await runMoves(username, moves, prefix);
  }
}

function accountDb(username: string) {
  return offlineDbForAccount(offlineAccountKeyFromUsername(username));
}

async function runMoves(
  username: string,
  pending: ReadonlyArray<{ from: string; to: string }>,
  journalPrefix: string,
): Promise<void> {
  const db = accountDb(username);
  // Unique per run: two tabs may apply changes at the same time.
  const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const parked = pending.map((move, index) => ({
    parking: `${PARKING_PREFIX}/${run}/${index}`,
    from: move.from,
    to: move.to,
  }));
  await db.transaction(
    "rw",
    [db.meta, driveContentBlobsTable(db), driveAvailabilityTable(db), docsAvailabilityTable(db)],
    async () => {
      for (const { from, parking } of parked) await migrateNodeSidecars(username, from, parking);
      for (const { parking, to } of parked) await migrateNodeSidecars(username, parking, to);
      await db.meta.where("key").startsWith(journalPrefix).delete();
    },
  );
}
