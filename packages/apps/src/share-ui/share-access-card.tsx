import type { ReactNode } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { cn } from "@/lib/utils";

import "@/share-ui/share-ui.css";

export type ShareAccessCardProps = {
  title: string;
  /** Section icon before the caption. */
  icon?: ReactNode;
  /** The add field: the caption names it. */
  htmlFor?: string;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  addControl?: ReactNode;
  footer?: ReactNode;
};

/** Who has access: caption on top, then the add field and the member rows. */
export function ShareAccessCard({
  title,
  icon,
  htmlFor,
  description,
  className,
  children,
  addControl,
  footer,
}: ShareAccessCardProps) {
  return (
    <FieldLabelRow
      layout="inline"
      section
      className={cn("share-access-card", className)}
      label={title}
      icon={icon}
      htmlFor={htmlFor}
      description={description}
      below={
        <>
          {addControl != null ? <div className="share-dialog__add-grant">{addControl}</div> : null}
          {children}
          {footer}
        </>
      }
    >
      {null}
    </FieldLabelRow>
  );
}
