import { Fragment, type CSSProperties } from "react";
import { linkifyText } from "./linkify-text";

/** Plain text where http(s) and mailto links are clickable (new tab). The text is unchanged. */
export function LinkifiedText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{ display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}
    >
      {linkifyText(text).map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "underline" }}
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}
