import type { DriveAPIOperations } from "@/lib/files/drive-types";
import { notifyDocsCachesChanged } from "@/lib/offline/docs/docs-inbound-sync";
import { moveDocsPath } from "@/lib/offline/docs/docs-path-moves";
import { notifyDriveRemoteChange } from "@/lib/offline/drive/drive-file-node-push";
import {
  createHybridDriveOperations,
  type HybridDriveWriteHooks,
} from "@/lib/offline/drive/drive-hybrid-operations";

/**
 * What Docs adds to a Drive file write (#2063 C4). Drive's factory writes the
 * file, queues it offline and keeps the tree; Docs only moves the text this
 * device keeps for a moved Doc (so an open editor follows it, in any tab) and
 * tells its tabs that the stars changed. Collab persistence, page setup and
 * availability on rename and trash are Drive's sidecar rules already.
 */
export function docsFileWriteHooks(username: string): HybridDriveWriteHooks {
  return {
    onMoved: (from, to) => moveDocsPath(username, from, to),
    onStarred: () => {
      notifyDocsCachesChanged(username);
      // The Starred view of the tree reads the star set again, in every tab.
      notifyDriveRemoteChange(username);
    },
  };
}

/** Docs home file operations: Drive's hybrid operations with the Docs hooks. */
export function createDocsFileOperations(username: string): DriveAPIOperations {
  return createHybridDriveOperations(username, null, docsFileWriteHooks(username));
}
