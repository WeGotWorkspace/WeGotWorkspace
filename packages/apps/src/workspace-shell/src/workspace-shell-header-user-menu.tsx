import { LogOut } from "lucide-react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

export type WorkspaceShellHeaderUserMenuProps = {
  displayName: string;
  onLogout?: () => void;
};

/** Compact initials avatar + account dropdown — shared by home and meet shell headers. */
export function WorkspaceShellHeaderUserMenu({
  displayName,
  onLogout,
}: WorkspaceShellHeaderUserMenuProps) {
  // Offline sign-out cannot revoke the refresh token and discards unsynced changes.
  const { online } = useConnectivity();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Named by the avatar's image label, not an aria-label on the button: the visible
            initials ("JD") live inside that image, so the name never contradicts what is on
            screen (WCAG 2.5.3 / axe label-content-name-mismatch). */}
        <button type="button" className="workspace-shell-header__user-menu-trigger">
          <UserAvatar
            displayName={displayName}
            compact
            size="md"
            className="workspace-shell-header__user-avatar"
            ariaLabel={`User menu, ${displayName}`}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="workspace-shell-header__user-menu-content">
        <DropdownMenuItem className="text-xs opacity-60 focus:bg-transparent">
          {displayName}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onLogout} disabled={!online} className="cursor-pointer">
          <LogOut className="size-4 mr-2" />
          {online ? "Sign out" : "Sign out is unavailable offline"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
