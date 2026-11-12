import type { ReactNode } from "react";
import { Card } from "@/card/src/card";

/** Catalog chrome for Settings-app panes. Dialog CSS strips the card. */
export function SettingsPaneCard({
  title,
  icon,
  children,
}: {
  title?: string;
  /** Marks the section, like the section rows in dialogs (Team access, Public link). */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="settings-pane-card" title={title} titleIcon={icon}>
      {children}
    </Card>
  );
}
