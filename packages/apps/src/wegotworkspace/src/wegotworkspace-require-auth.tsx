import { useEffect, type ComponentType, type ReactNode } from "react";
import { useNavigate, useRouterState, type RouteComponent } from "@tanstack/react-router";
import {
  wgwEnsureSession,
  wgwHasAuthenticatedSession,
  wgwLiveApiEnabled,
  wgwSessionAvailable,
} from "@/lib/api/wgw/http";
import {
  isWgwAuthRoutePathname,
  isWgwPublicRoutePathname,
  sanitizeWgwReturnPath,
} from "@/lib/api/wgw/route-guard";

type WeGotWorkspaceRequireAuthProps = {
  children: ReactNode;
};

function WeGotWorkspaceRequireAuth({ children }: WeGotWorkspaceRequireAuthProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const hash = useRouterState({ select: (state) => state.location.hash });

  useEffect(() => {
    if (!wgwLiveApiEnabled()) return;
    if (wgwHasAuthenticatedSession()) return;
    if (isWgwAuthRoutePathname(pathname)) return;
    if (isWgwPublicRoutePathname(pathname)) return;

    let cancelled = false;

    void (async () => {
      if (wgwSessionAvailable()) {
        try {
          await wgwEnsureSession();
        } catch {
          // Ensure failed — fall through to re-check / redirect.
        }
        if (cancelled) return;
        if (wgwHasAuthenticatedSession()) return;
      }

      if (cancelled) return;
      const returnPath = sanitizeWgwReturnPath(`${pathname}${searchStr}${hash}`);
      void navigate({
        to: "/login",
        search: { return: returnPath },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [hash, navigate, pathname, searchStr]);

  return children;
}

export function withWeGotWorkspaceAuth<Props extends object>(
  Component: ComponentType<Props>,
): RouteComponent {
  function AuthenticatedRoute(props: Props) {
    return (
      <WeGotWorkspaceRequireAuth>
        <Component {...props} />
      </WeGotWorkspaceRequireAuth>
    );
  }
  AuthenticatedRoute.displayName = `WithWeGotWorkspaceAuth(${Component.displayName ?? Component.name ?? "Route"})`;
  return AuthenticatedRoute as unknown as RouteComponent;
}
