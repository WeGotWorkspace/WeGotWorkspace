import { HeadContent, Link, Outlet } from "@tanstack/react-router";
import { OfflineStatusIndicator } from "@/lib/offline/offline-status-indicator";
import { MeetCallMiniPlayer } from "@/meet-core/src/meet-call-mini-player";
import { AppToaster } from "@/ui/sonner";
import { TooltipProvider } from "@/ui/tooltip";

export function WeGotWorkspaceShell() {
  return (
    <TooltipProvider delayDuration={300}>
      <HeadContent />
      <OfflineStatusIndicator />
      <Outlet />
      {/* Active-call card outside /meet; renders nothing without the suite call store. */}
      <MeetCallMiniPlayer />
      <AppToaster />
    </TooltipProvider>
  );
}

export function WeGotWorkspaceNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/drive"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to Drive
          </Link>
        </div>
      </div>
    </div>
  );
}
