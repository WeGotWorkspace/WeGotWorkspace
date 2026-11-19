import { createContext, forwardRef, useContext, type ComponentPropsWithoutRef } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui/tooltip";
import { UserAvatar, initialsFromDisplayName } from "@/user-avatar/src/user-avatar";
import { clearLastAppLocations } from "@/app-rail/src/last-app-location";
import { forgetShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";

/**
 * The rail's bottom slot. AppSidebar publishes the element; the sidebar's
 * account footer (which owns the session and the log-out handler) fills it,
 * so no workspace has to pass the account to the rail.
 */
export const AppRailAccountSlotContext = createContext<HTMLElement | null>(null);

export type AppRailAccountProps = {
  /** Display name; falls back to `initials` for the mark when empty. */
  name: string;
  initials: string;
  onLogout?: () => void;
};

type AccountTriggerProps = ComponentPropsWithoutRef<"button"> & {
  /** Tooltip text: who is signed in and whether they are online. */
  hint: string;
};

/**
 * The menu trigger with its tooltip. The button takes the ref and props the
 * dropdown hands down, so both the menu and the tooltip bind to it.
 */
const AccountTrigger = forwardRef<HTMLButtonElement, AccountTriggerProps>(function AccountTrigger(
  { hint, children, ...props },
  ref,
) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button ref={ref} type="button" className="app-rail__account-trigger" {...props}>
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

/** Signed-in user at the foot of the rail: avatar + connectivity pip, menu with Log out. */
function AppRailAccount({ name, initials, onLogout }: AppRailAccountProps) {
  const { online } = useConnectivity();
  const avatarName = name.trim() || initials.trim();
  if (!avatarName) return null;
  const connectivityLabel = online ? "online" : "offline";

  return (
    <DropdownMenu
      align="start"
      trigger={
        <AccountTrigger
          hint={`${avatarName} (${connectivityLabel})`}
          // The page's connectivity marker (e2e waits on it); the sidebar card had it before.
          data-connectivity={connectivityLabel}
        >
          {/*
            The avatar names the button. The name carries the initials the mark
            shows, so the visible text is part of it (WCAG 2.5.3).
          */}
          <UserAvatar
            displayName={avatarName}
            compact
            presence={online ? "online" : "away"}
            ariaLabel={`${avatarName}, ${initialsFromDisplayName(avatarName) || "?"}, ${connectivityLabel}. Account menu`}
          />
        </AccountTrigger>
      }
      items={[
        {
          id: "logout",
          label: "Log out",
          icon: <LogOut className="size-4" aria-hidden />,
          onClick: () => {
            // The next person in this tab starts clean: no remembered spots, no Admin answer.
            clearLastAppLocations();
            forgetShowAdminApp();
            onLogout?.();
          },
        },
      ]}
    />
  );
}

/** Renders the account button into the rail's slot. Nothing without a rail. */
export function AppRailAccountPortal(props: AppRailAccountProps) {
  const slot = useContext(AppRailAccountSlotContext);
  if (!slot) return null;
  return createPortal(<AppRailAccount {...props} />, slot);
}
