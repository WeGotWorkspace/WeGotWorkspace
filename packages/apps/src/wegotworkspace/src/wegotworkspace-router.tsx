import { useMemo } from "react";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import {
  createWeGotWorkspaceRouter,
  type WeGotWorkspaceMockRoutes,
  type WeGotWorkspaceRouteMode,
} from "@/wegotworkspace/src/wegotworkspace-routes";

type WeGotWorkspaceRouterProps = {
  mode: WeGotWorkspaceRouteMode;
  history: RouterHistory;
  /** Required in mock mode (`wegotworkspaceMockRoutes`). */
  mockRoutes?: WeGotWorkspaceMockRoutes;
};

export function WeGotWorkspaceRouter({ mode, history, mockRoutes }: WeGotWorkspaceRouterProps) {
  const router = useMemo(
    () => createWeGotWorkspaceRouter({ mode, history, mockRoutes }),
    [history, mode, mockRoutes],
  );

  return <RouterProvider router={router} />;
}
