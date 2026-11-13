import type { ReactNode } from "react";
import { Card } from "@/card/src/card";

/**
 * Section wrapper for Settings panes. `settings-workspace.css` strips the card chrome on the
 * page and in the dialog; only the section title and icon stay.
 */
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
