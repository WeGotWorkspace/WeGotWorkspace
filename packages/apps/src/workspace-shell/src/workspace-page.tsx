import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Card } from "@/card/src/card";
import { PathBreadcrumb } from "@/path-breadcrumb/src/path-breadcrumb";
import "@/workspace-shell/src/workspace-page.css";

/**
 * Open-page layout shared by Settings and Admin: a header path ("Settings › Account"),
 * a large page title with a short description, and sections that sit straight on the page.
 */

/** The link before the group title in the header ("Settings ›", "Admin ›"). */
export function WorkspacePageTrail({
  label,
  path,
  onNavigate,
}: {
  label: string;
  /** Path of the page the link opens; it stays a link on that page too. */
  path: string;
  onNavigate: () => void;
}) {
  return (
    <span className="workspace-page-trail">
      <PathBreadcrumb
        items={[{ label, path }]}
        currentPath={path}
        alwaysNavigablePaths={[path]}
        onNavigate={onNavigate}
      />
      <ChevronRight className="workspace-page-trail__separator" aria-hidden />
    </span>
  );
}

/** Large title, the pane's state at the end of its row, a description under it. */
export function WorkspacePageHeader({
  title,
  description,
  status,
}: {
  title: string;
  description?: ReactNode;
  /** End of the title row: a save tag or the pane's own state tag. */
  status?: ReactNode;
}) {
  return (
    <header className="workspace-page-header">
      <div className="workspace-page-header__title-row">
        <h1 className="workspace-page-header__title">{title}</h1>
        {status != null ? <div className="workspace-page-header__status">{status}</div> : null}
      </div>
      {description ? <p className="workspace-page-header__description">{description}</p> : null}
    </header>
  );
}

/** A section on the page: no card chrome, only its title (and icon or end action). */
export function WorkspacePageSection({
  title,
  titleTag,
  action,
  className,
  children,
}: {
  title?: string;
  /** Right after the title, such as a role tag. */
  titleTag?: ReactNode;
  /** Accepted, not shown: section headings carry no icon. */
  icon?: ReactNode;
  /** End of the title row, such as a status tag or an add button. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={className ? `workspace-page-section ${className}` : "workspace-page-section"}
      title={title}
      titleTag={titleTag}
      action={action}
    >
      {children}
    </Card>
  );
}
