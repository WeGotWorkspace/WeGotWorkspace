import { parkWrites, type ParkedWrite } from "@/lib/offline/core/parked-writes";

/** The parked writes of one container the person lost write access to. */
export type RescueGroup<T = unknown> = {
  containerId: string;
  containerName: string;
  reason: ParkedWrite["reason"];
  writes: ParkedWrite<T>[];
};

/**
 * One group per container, in the order the containers were first refused;
 * the newest refusal gives the reason.
 */
export function groupParkedWrites<T>(writes: ParkedWrite<T>[]): RescueGroup<T>[] {
  const groups = new Map<string, RescueGroup<T>>();
  for (const write of [...writes].sort((a, b) => a.parkedAt - b.parkedAt)) {
    const group = groups.get(write.containerId);
    if (group) {
      group.writes.push(write);
      group.reason = write.reason;
    } else
      groups.set(write.containerId, {
        containerId: write.containerId,
        containerName: write.containerName,
        reason: write.reason,
        writes: [write],
      });
  }
  return [...groups.values()];
}

/** Where rescued items go: a container the person can write to, or a new one by name. */
export type RescueTarget = { containerId: string } | { newContainerName: string };

/** How an app makes a container and creates a parked item in one. */
export type RescueOperations<T> = {
  /** Omit where the app cannot make containers; a new-container target then fails. */
  createContainer?: (name: string) => Promise<{ id: string }>;
  /** Create the parked item anew in the container; the server picks a new id. */
  createItemIn: (containerId: string, item: T) => Promise<unknown>;
};

export class RescueError extends Error {
  constructor(readonly failed: number) {
    super(`Could not move ${failed} rescued item(s)`);
    this.name = "RescueError";
  }
}

/**
 * Create each taken write as a new item in the target container (made first
 * when it is new). An item that fails goes back to the park, so nothing is lost.
 */
export async function rescueParkedWrites<T>(
  username: string,
  domain: string,
  writes: ParkedWrite<T>[],
  target: RescueTarget,
  operations: RescueOperations<T>,
  /** A write is created or parked again: it no longer needs to be kept apart. */
  onSettled?: (write: ParkedWrite<T>) => Promise<void>,
): Promise<{ containerId: string }> {
  let containerId = "containerId" in target ? target.containerId : "";
  try {
    if ("newContainerName" in target) {
      if (!operations.createContainer) throw new Error("Containers cannot be created here");
      containerId = (await operations.createContainer(target.newContainerName)).id;
    }
  } catch (error) {
    await parkWrites(username, domain, writes);
    for (const write of writes) await onSettled?.(write);
    throw error;
  }
  const failed: ParkedWrite<T>[] = [];
  for (const write of writes) {
    const created = await operations
      .createItemIn(containerId, write.item)
      .then(() => true)
      .catch(() => false);
    if (created) await onSettled?.(write);
    else failed.push(write);
  }
  if (failed.length > 0) {
    await parkWrites(username, domain, failed);
    for (const write of failed) await onSettled?.(write);
    throw new RescueError(failed.length);
  }
  return { containerId };
}
