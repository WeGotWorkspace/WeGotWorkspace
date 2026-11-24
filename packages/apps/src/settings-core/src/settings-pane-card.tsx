import type { ReactNode } from "react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";

/** Section wrapper for Settings panes, on the page and in the dialog. */
export function SettingsPaneCard({
  title,
  icon,
  titleTag,
  action,
  children,
}: {
  title?: string;
  /** Right after the title, such as a role tag. */
  titleTag?: ReactNode;
  /** Marks the section, like the section rows in dialogs (Team access, Public link). */
  icon?: ReactNode;
  /** End of the title row, such as a status tag. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WorkspacePageSection
      className="settings-pane-card"
      title={title}
      icon={icon}
      titleTag={titleTag}
      action={action}
    >
      {children}
    </WorkspacePageSection>
  );
}
