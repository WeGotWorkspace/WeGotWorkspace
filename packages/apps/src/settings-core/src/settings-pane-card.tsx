import type { ReactNode } from "react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";

/** Section wrapper for Settings panes, on the page and in the dialog. */
export function SettingsPaneCard({
  title,
  icon,
  titleAccessory,
  action,
  className,
  children,
}: {
  title?: string;
  /** Marks the section, like the section rows in dialogs (Team access, Public link). */
  icon?: ReactNode;
  /** Right after the title, such as a source tag. */
  titleAccessory?: ReactNode;
  className?: string;
  /** End of the title row, such as a status tag. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WorkspacePageSection
      className={className ? `settings-pane-card ${className}` : "settings-pane-card"}
      title={title}
      icon={icon}
      titleAccessory={titleAccessory}
      action={action}
    >
      {children}
    </WorkspacePageSection>
  );
}
