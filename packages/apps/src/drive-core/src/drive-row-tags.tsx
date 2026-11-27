import { Tag } from "@/tag/src/tag";

/** Tag chips a list row shows beside the name; the rest collapse into "+n". */
const ROW_TAG_LIMIT = 2;

/** The tags of a Drive or Docs row (#2402), compact: two chips and a count for the rest. */
export function DriveRowTags({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, ROW_TAG_LIMIT);
  const more = tags.length - shown.length;
  return (
    <span className="drive-row-tags" data-testid="drive-row-tags">
      {shown.map((tag) => (
        <Tag key={tag} label={tag} size="lg" />
      ))}
      {more > 0 ? <span className="drive-row-tags__more">{`+${more}`}</span> : null}
    </span>
  );
}
