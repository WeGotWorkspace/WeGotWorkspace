import type { TrackedChangeInfo } from "tiptap-track-changes";
import { DocsCollabHighlightText } from "../docs-collab-card";
import { formatMarkPreviewClassName } from "./docs-suggestion-format-mark-styles";

function SuggestionDiffArrow() {
  return (
    <span className="docs-suggestion-card__diff-arrow" aria-hidden>
      {" → "}
    </span>
  );
}

export type SuggestionDiffBodyProps = {
  parts: TrackedChangeInfo[];
  /** Plain-text summary for screen readers (from `DocsTrackChangeGroup.summary`). */
  ariaLabel: string;
  /** Full diff text for native tooltip when the card is inactive and clamped. */
  title?: string;
};

function FormatChangeHighlight({
  side,
  formatName,
  text,
}: {
  side: "before" | "after";
  formatName: string | undefined;
  text: string;
}) {
  const className = formatName
    ? formatMarkPreviewClassName(side, formatName)
    : side === "before"
      ? "docs-collab-highlight__format-before"
      : "docs-collab-highlight__format-after";

  return (
    <DocsCollabHighlightText variant="format">
      <span className={className}>{text}</span>
    </DocsCollabHighlightText>
  );
}

export function SuggestionDiffBody({ parts, ariaLabel, title }: SuggestionDiffBodyProps) {
  const insertion = parts.find((part) => part.type === "insertion");
  const deletion = parts.find((part) => part.type === "deletion");
  const formatChange = parts.find((part) => part.type === "formatChange");
  const formatText = formatChange?.text;
  const formatRemoved = formatChange?.formatRemoved;
  const formatAdded = formatChange?.formatAdded;

  return (
    <p className="docs-suggestion-card__diff" aria-label={ariaLabel} title={title}>
      <span className="docs-collab-card__clamp">
        {formatChange ? (
          formatText ? (
            formatRemoved || formatAdded ? (
              <>
                <FormatChangeHighlight side="before" formatName={formatRemoved} text={formatText} />
                <SuggestionDiffArrow />
                <FormatChangeHighlight side="after" formatName={formatAdded} text={formatText} />
              </>
            ) : (
              formatText
            )
          ) : (
            "Format change"
          )
        ) : (
          <>
            {deletion ? (
              <DocsCollabHighlightText variant="deletion">
                {deletion.text || "Delete text"}
              </DocsCollabHighlightText>
            ) : null}
            {deletion && insertion ? <SuggestionDiffArrow /> : null}
            {insertion ? (
              <DocsCollabHighlightText variant="insertion">
                {insertion.text || "Insert text"}
              </DocsCollabHighlightText>
            ) : null}
          </>
        )}
      </span>
    </p>
  );
}
