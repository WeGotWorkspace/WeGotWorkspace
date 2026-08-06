import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { SidebarLogo } from "@/sidebar-logo/src/sidebar-logo";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import {
  WORKSPACE_SIDEBAR_TOGGLE_STYLE,
  WORKSPACE_USER_LOGOUT_STYLE,
} from "@/workspace-shell/src/workspace-app-layout.styles";
import { cn } from "@/lib/utils";
import "@/workspace-shell/src/workspace-app-layout.css";

type WorkspaceAppLayoutBaseProps = {
  style?: React.CSSProperties;
  className?: string;
};

/** Full-width row of arbitrary nodes (e.g. drive + legacy stories). */
export type WorkspaceAppLayoutFlatProps = WorkspaceAppLayoutBaseProps & {
  children: React.ReactNode;
  sidebar?: undefined;
  main?: undefined;
  mainHeader?: undefined;
};

/** Sidebar + main column with optional header and a scrollable body (settings, admin). */
export type WorkspaceAppLayoutSplitProps = WorkspaceAppLayoutBaseProps & {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  mainHeader?: React.ReactNode;
  /** Optional right-hand panel (e.g. docs comments sidebar). */
  panel?: React.ReactNode;
  children?: undefined;
};

export type WorkspaceAppLayoutProps = WorkspaceAppLayoutFlatProps | WorkspaceAppLayoutSplitProps;

function isSplitLayout(props: WorkspaceAppLayoutProps): props is WorkspaceAppLayoutSplitProps {
  return "sidebar" in props && "main" in props;
}

type WorkspaceSidebarProps = {
  open: boolean;
  children: React.ReactNode;
};

type WorkspaceBrandHeaderProps = {
  onCloseMobile: () => void;
  showAppSwitcher?: boolean;
  appSwitcher?: React.ReactNode;
  closeButtonHoverClassName?: string;
};

type WorkspaceUserFooterProps = {
  name: string;
  initials: string;
  /** Optional second line (e.g. email) next to the avatar; when set, name/subtitle use `UserAvatar` layout. */
  detailLine?: string;
  onLogoutClick?: () => void;
  linkHoverClassName?: string;
};

type WorkspaceSidebarToggleProps = {
  open: boolean;
  onToggle: () => void;
  hoverClassName?: string;
};

export function WorkspaceAppLayout(props: WorkspaceAppLayoutProps) {
  const { style, className } = props;
  return (
    <div className={cn("workspace-columns notes-root", className)} style={style}>
      {isSplitLayout(props) ? (
        <>
          {props.sidebar}
          <section className="workspace-app-layout__main">
            {props.mainHeader != null ? (
              <header className="workspace-app-layout__main-header">{props.mainHeader}</header>
            ) : null}
            <div className="workspace-app-layout__main-scroll">
              <div className="workspace-app-layout__main-content">{props.main}</div>
            </div>
          </section>
          {props.panel ?? null}
        </>
      ) : (
        props.children
      )}
    </div>
  );
}

export function WorkspaceSidebar({ open, children }: WorkspaceSidebarProps) {
  return (
    <aside
      data-open={open}
      className={`fixed sidebar:static z-40 inset-y-0 left-0 shrink-0 flex flex-col border-r shadow-2xl sidebar:shadow-none transition-[translate,margin,border-width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden will-change-transform ${
        open
          ? "translate-x-0 w-72 sidebar:w-64"
          : "-translate-x-full w-72 sidebar:w-64 sidebar:-ml-64 sidebar:border-r-0"
      }`}
      style={{
        backgroundColor:
          "var(--workspace-sidebar-bg, var(--color-paper, var(--color-cream, #ffffff)))",
        borderColor:
          "var(--workspace-sidebar-border-color, color-mix(in oklab, var(--color-ink) 15%, transparent))",
        color: "var(--workspace-sidebar-color, var(--color-ink))",
      }}
    >
      {children}
    </aside>
  );
}

export function WorkspaceBrandHeader({
  onCloseMobile,
  showAppSwitcher = true,
  appSwitcher,
  closeButtonHoverClassName = "hover:bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)]",
}: WorkspaceBrandHeaderProps) {
  return (
    <SidebarLogo
      onCloseMobile={onCloseMobile}
      showAppSwitcher={showAppSwitcher}
      appSwitcher={appSwitcher}
      closeButtonHoverClassName={closeButtonHoverClassName}
    />
  );
}

export function WorkspaceUserFooter({
  name,
  initials,
  detailLine,
  onLogoutClick,
  linkHoverClassName = "hover:bg-[color-mix(in_oklab,var(--color-ink)_18%,transparent)]",
}: WorkspaceUserFooterProps) {
  const trimmedName = name.trim();
  const trimmedDetailLine = detailLine?.trim() ?? "";
  const trimmedInitials = initials.trim();
  const hasIdentity = trimmedName.length > 0 || trimmedDetailLine.length > 0;
  if (!hasIdentity) return null;
  const avatarName = trimmedName || trimmedInitials;
  const handleLogout = () => onLogoutClick?.();
  return (
    <div className="workspace-app-layout__user-footer">
      <UserAvatar
        displayName={avatarName}
        subtitle={detailLine}
        compact={!detailLine}
        className={detailLine ? "flex-1 min-w-0" : "shrink-0"}
      />
      {!detailLine ? <div className="flex-1 min-w-0 text-sm truncate">{name}</div> : null}
      <IconButton
        label="Log out"
        icon={<LogOut />}
        onClick={handleLogout}
        variant="subtle"
        className={cn("size-9", linkHoverClassName)}
        style={WORKSPACE_USER_LOGOUT_STYLE}
      />
    </div>
  );
}

export function WorkspaceSidebarScrim({ open, onClick }: { open: boolean; onClick: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-30 bg-black/30 sidebar:hidden animate-in fade-in duration-300"
      onClick={onClick}
    />
  );
}

export function WorkspaceSidebarToggle({
  open,
  onToggle,
  hoverClassName = "hover:bg-[color-mix(in_oklab,var(--color-ink)_12%,transparent)]",
}: WorkspaceSidebarToggleProps) {
  return (
    <IconButton
      label={open ? "Hide sidebar" : "Show sidebar"}
      onClick={onToggle}
      icon={
        <>
          <Menu className="size-4 sidebar:hidden" />
          {open ? (
            <PanelLeftClose className="size-4 hidden sidebar:block" />
          ) : (
            <PanelLeftOpen className="size-4 hidden sidebar:block" />
          )}
        </>
      }
      variant="subtle"
      className={cn("size-9 shrink-0", hoverClassName)}
      style={WORKSPACE_SIDEBAR_TOGGLE_STYLE}
    />
  );
}
