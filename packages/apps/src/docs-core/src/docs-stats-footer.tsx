import type { ReactNode } from "react";
import { Tag } from "@/tag/src/tag";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";
import type { useDocsController } from "@/docs-core/src/use-docs-controller";

type DocsController = ReturnType<typeof useDocsController>;

export type DocsStatsFooterProps = {
  controller: DocsController;
  status?: ReactNode;
};

export type DocsEditorStatsFooterProps = {
  wordCount: number;
  characterCount: number;
  statsWordsLabel: (count: number) => string;
  statsCharactersLabel: (count: number) => string;
  status?: ReactNode;
};

export function DocsEditorStatsFooter({
  wordCount,
  characterCount,
  statsWordsLabel,
  statsCharactersLabel,
  status,
}: DocsEditorStatsFooterProps) {
  return (
    <WorkspaceChromeFooter className="docs-workspace__stats-footer" end={status}>
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
    </WorkspaceChromeFooter>
  );
}

export function DocsStatsFooter({ controller, status }: DocsStatsFooterProps) {
  if (!controller.hasFile) return null;

  return (
    <DocsEditorStatsFooter
      wordCount={controller.wordCount}
      characterCount={controller.characterCount}
      statsWordsLabel={controller.labels.statsWords}
      statsCharactersLabel={controller.labels.statsCharacters}
      status={status}
    />
  );
}
