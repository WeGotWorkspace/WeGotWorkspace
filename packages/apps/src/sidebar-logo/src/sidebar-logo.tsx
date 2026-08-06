import { X } from "lucide-react";

type SidebarLogoProps = {
  showAppSwitcher?: boolean;
  /** When `showAppSwitcher` is true, render this node (e.g. `WorkspaceAppSwitcher` / `AppSwitchButton`, which includes the app icon). */
  appSwitcher?: React.ReactNode;
  onCloseMobile: () => void;
  closeButtonHoverClassName?: string;
};

export function SidebarLogo({
  showAppSwitcher = true,
  appSwitcher,
  onCloseMobile,
  closeButtonHoverClassName = "hover:bg-[color-mix(in_oklab,var(--color-ink)_8%,transparent)]",
}: SidebarLogoProps) {
  return (
    <div className="p-6 flex items-center gap-3 justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {showAppSwitcher && appSwitcher ? appSwitcher : null}
      </div>
      <button
        aria-label="Close menu"
        onClick={onCloseMobile}
        className={`size-8 rounded-full flex items-center justify-center transition-colors sidebar:hidden ${closeButtonHoverClassName}`}
        style={{ color: "var(--sidebar-logo-close-button-color, var(--color-ink))" }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
