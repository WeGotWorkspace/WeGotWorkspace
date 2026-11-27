import { useEffect, useState } from "react";
import { subscribeDriveRemoteChanges } from "@/lib/offline/drive/drive-file-node-push";
import { queryFileTreeTags } from "@/lib/files/tree-view/tree-view-query";

/**
 * The tags in use on the device's file tree (#2402), for the sidebar's Tags section in Drive
 * and Docs. Reads again whenever the Drive cache changes in any tab.
 */
export function useFileTreeTags(username: string): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    if (!username) return undefined;
    let current = true;
    const read = () => {
      void queryFileTreeTags(username).then(
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
  }, [username]);
  return tags;
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
