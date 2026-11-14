import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "@/text-editor-core/docs-collab/docs-collab-card/docs-collab-highlight.css";

export type DocsCollabHighlightVariant = "insertion" | "deletion" | "comment" | "format";

export type DocsCollabHighlightTextProps = {
  variant: DocsCollabHighlightVariant;
  children: ReactNode;
  className?: string;
};

function highlightClassName(variant: DocsCollabHighlightVariant, className?: string) {
  return ["docs-collab-highlight", `docs-collab-highlight--${variant}`, className]
    .filter(Boolean)
    .join(" ");
}

export function DocsCollabHighlightText({
  variant,
  children,
  className,
  ...rest
}: DocsCollabHighlightTextProps &
  Omit<ComponentPropsWithoutRef<"span">, keyof DocsCollabHighlightTextProps>) {
  const classes = highlightClassName(variant, className);

  if (variant === "insertion") {
    return (
      <ins className={classes} {...(rest as ComponentPropsWithoutRef<"ins">)}>
        {children}
      </ins>
    );
  }

  if (variant === "deletion") {
    return (
      <del className={classes} {...(rest as ComponentPropsWithoutRef<"del">)}>
        {children}
      </del>
    );
  }

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
