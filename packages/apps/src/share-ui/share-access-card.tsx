import type { ReactNode } from "react";
import { Card } from "@/card/src/card";
import { cn } from "@/lib/utils";

import "@/share-ui/share-ui.css";

export type ShareAccessCardProps = {
  title: string;
  titleIcon?: ReactNode;
  description?: ReactNode;
  className?: string;
  children?: ReactNode;
  addControl?: ReactNode;
  footer?: ReactNode;
};

/** Presentational Team-access card: header, member rows, then add input. */
export function ShareAccessCard({
  title,
  titleIcon,
  description,
  className,
  children,
  addControl,
  footer,
}: ShareAccessCardProps) {
  return (
    <Card
      className={cn("share-access-card", className)}
      titleIcon={titleIcon}
      title={title}
      description={description}
    >
      <div className="share-access-card__body">
        {children}
        {addControl != null ? <div className="share-dialog__add-grant">{addControl}</div> : null}
      </div>
      {footer}
    </Card>
  );
}
