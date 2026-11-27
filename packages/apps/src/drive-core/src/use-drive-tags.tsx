import { useCallback, useMemo } from "react";
import { Tag as TagIcon } from "lucide-react";
import { resolveDriveFileApiPath } from "@/drive-core/src/drive-batch-utils";
import { patchAllFilesRows } from "@/drive-core/src/drive-view-rows";
import type { DriveListState } from "@/drive-core/src/use-drive-list";
import type { DriveShellState } from "@/drive-core/src/use-drive-shell";
import type { DriveFile } from "@/lib/files/drive-models";
import { invertTagDelta, tagsAfterDelta, type TagDelta } from "@/lib/tags/tag-delta";

/**
 * Tags on Drive and Docs rows (#2402). One write path for one file or a selection:
 * a delta per row, undoable, sent as it is made. Offered only where the operations
 * can set tags (signed-in accounts; not guests).
 */
export function useDriveTags({ shell, list }: { shell: DriveShellState; list: DriveListState }) {
  const { files, setFiles, view, operations, currentUsername, groupRootNames, inTrashView } = shell;
  const { fileById, queueMutation } = list;
  const setTags = operations?.setTags;

  const canEditTags = useCallback(
    (file: DriveFile | null | undefined): boolean =>
      Boolean(setTags) &&
      !inTrashView &&
      file != null &&
      file.mayManageStructure !== false &&
      Boolean(file.apiPath?.trim()),
    [inTrashView, setTags],
  );

  const changeTags = useCallback(
    (ids: readonly string[], delta: TagDelta) => {
      if (!setTags) return;
      const rows = ids
        .map((id) => fileById(id))
        .filter((file): file is DriveFile => canEditTags(file));
      if (rows.length === 0) return;
      const writable = new Set(rows.map((row) => row.id));
      const before = new Map(rows.map((row) => [row.id, row.tags]));
      const apply = (items: DriveFile[]) =>
        items.map((item) =>
          writable.has(item.id) ? { ...item, tags: tagsAfterDelta(item.tags, delta) } : item,
        );
      const restore = (items: DriveFile[]) =>
        items.map((item) =>
          writable.has(item.id) ? { ...item, tags: before.get(item.id) ?? [] } : item,
        );
      setFiles(apply);
      const restoreFlat = patchAllFilesRows(view, shell.patchAllFiles, apply);
      const writes = rows.map((row) => {
        const path = resolveDriveFileApiPath(row, currentUsername, groupRootNames);
        const after = tagsAfterDelta(row.tags, delta);
        return { path, delta, undoDelta: invertTagDelta(row.tags, after) };
      });
      queueMutation({
        key: `drive:tags:${[...writable].join(",")}`,
        toastMessage: rows.length === 1 ? "Tags updated" : `Tags updated on ${rows.length} items`,
        icon: <TagIcon className="size-4" />,
        execute: async (signal) => {
          for (const write of writes)
            await setTags({ path: write.path, ...write.delta }, { signal });
        },
        revert: async () => {
          for (const write of writes) await setTags({ path: write.path, ...write.undoDelta });
        },
        undo: () => {
          setFiles(restore);
          restoreFlat();
        },
        undoToastMessage: "Tag change undone.",
      });
    },
    [
      canEditTags,
      currentUsername,
      fileById,
      groupRootNames,
      queueMutation,
      setFiles,
      setTags,
      shell.patchAllFiles,
      view,
    ],
  );

  /** Tags in use on the rows the person has loaded, for the editor's suggestions. */
  const tagSuggestions = useMemo(
    () => [...new Set(files.flatMap((file) => file.tags))].sort((a, b) => a.localeCompare(b)),
    [files],
  );

  return { canEditTags, changeTags, tagSuggestions, tagsEnabled: Boolean(setTags) };
}
