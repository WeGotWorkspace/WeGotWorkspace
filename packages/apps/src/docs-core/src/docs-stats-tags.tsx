import { Tag } from "@/tag/src/tag";

export type DocsStatsTagsProps = {
  wordCount: number;
  characterCount: number;
  statsWordsLabel: (count: number) => string;
  statsCharactersLabel: (count: number) => string;
};

/** Word/char meta tags for the shared `WorkspaceDetailFooter` `tags` slot. */
export function DocsStatsTags({
  wordCount,
  characterCount,
  statsWordsLabel,
  statsCharactersLabel,
}: DocsStatsTagsProps) {
  return (
    <>
      <Tag
        label={statsWordsLabel(wordCount)}
        colors={{
          backgroundColor: "var(--docs-stat-tag-bg)",
          color: "var(--docs-stat-tag-color)",
        }}
      />
      <span className="docs-workspace__stats-footer-tag--characters">
        <Tag
          label={statsCharactersLabel(characterCount)}
          colors={{
            backgroundColor: "var(--docs-stat-tag-bg)",
            color: "var(--docs-stat-tag-color)",
          }}
        />
      </span>
    </>
  );
}
