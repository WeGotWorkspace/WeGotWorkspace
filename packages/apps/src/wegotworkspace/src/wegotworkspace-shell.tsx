import { HeadContent, Link, Outlet, useLocation } from "@tanstack/react-router";
import { DocsFilePreview } from "@/docs-core/src/docs-file-preview";
import { FilePreviewMarkdownRendererProvider } from "@/lib/file-preview/file-preview-markdown-renderer";
import { useReportRouteToPushHub } from "@/lib/api/wgw/use-jmap-state-change";
import { MeetCallMiniPlayer } from "@/meet-core/src/meet-call-mini-player";
import { MeetKnockChime } from "@/meet-core/src/meet-knock-chime";
import { NotificationsProvider } from "@/notifications-core/src/notifications-provider";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { SettingsDialogProvider } from "@/settings-core/src/settings-dialog-provider";
import {
  reachabilityFromShell,
  SettingsReachabilityProvider,
} from "@/settings-core/src/settings-reachability";
import { AppToaster } from "@/ui/sonner";
import { TooltipProvider } from "@/ui/tooltip";

/** Reports each navigation to the push hub, apart from the shell so it does not re-render it. */
function PushHubRouteReporter() {
  const route = useLocation({ select: (location) => location.pathname + location.searchStr });
  useReportRouteToPushHub(route);
  return null;
}

export function WeGotWorkspaceShell() {
  registerBuiltinSettings();
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsReachabilityProvider value={reachabilityFromShell({})}>
        <SettingsDialogProvider>
          {/* File previews render Markdown with Docs' read-only editor. */}
          <FilePreviewMarkdownRendererProvider renderer={DocsFilePreview}>
            <NotificationsProvider>
              <HeadContent />
              <PushHubRouteReporter />
              <Outlet />
              {/* Active-call card outside /meet; renders nothing without the suite call store. */}
              <MeetCallMiniPlayer />
              <MeetKnockChime />
              <AppToaster />
            </NotificationsProvider>
          </FilePreviewMarkdownRendererProvider>
        </SettingsDialogProvider>
      </SettingsReachabilityProvider>
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
