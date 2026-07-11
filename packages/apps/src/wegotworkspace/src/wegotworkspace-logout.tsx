import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { wgwCompleteLogoutNavigation } from "@/lib/api/wgw/http";

export function WeGotWorkspaceLogout() {
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const navigation = await wgwCompleteLogoutNavigation();
      if (navigation === "member_login") {
        await navigate({ to: "/login" });
      }
    })();
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">Signing out...</p>
    </main>
  );
}
