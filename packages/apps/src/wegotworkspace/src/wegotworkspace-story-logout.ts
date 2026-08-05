import { useNavigate } from "@tanstack/react-router";
import { wgwCompleteLogoutNavigation, wgwIsGuestSession } from "@/lib/api/wgw/http";

/** Storybook / mock shell: navigate to `/logout` instead of hard-reloading the page. */
export function useWeGotWorkspaceLogout() {
  const navigate = useNavigate();
  return () => {
    if (wgwIsGuestSession()) {
      void wgwCompleteLogoutNavigation();
      return;
    }
    void navigate({ to: "/logout" });
  };
}
