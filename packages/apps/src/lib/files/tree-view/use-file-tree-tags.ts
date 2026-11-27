import { useEffect, useMemo, useState } from "react";
import { subscribeDriveRemoteChanges } from "@/lib/offline/drive/drive-file-node-push";
import { queryFileTreeTags } from "@/lib/files/tree-view/tree-view-query";
import type { FileTreeEntryFilter } from "@/lib/files/tree-view/tree-view-predicates";

/**
 * The tags in use on the device's file tree (#2402), for the sidebar's Tags section in Drive
 * and Docs. Reads again whenever the Drive cache changes in any tab.
 */
export function useFileTreeTags(username: string, entryFilter?: FileTreeEntryFilter): string[] {
  const [tags, setTags] = useState<string[]>([]);
  const filterKey = JSON.stringify(entryFilter ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the serialized key tracks the filter content
  const filter = useMemo(() => entryFilter, [filterKey]);
  useEffect(() => {
    if (!username) return undefined;
    let current = true;
    const read = () => {
      void queryFileTreeTags(username, filter).then(
        (next) => {
          if (current) setTags((previous) => (sameTags(previous, next) ? previous : next));
        },
        () => undefined,
      );
    };
    read();
    const off = subscribeDriveRemoteChanges(username, read);
    return () => {
      current = false;
      off();
    };
  }, [username, filter]);
  return tags;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
