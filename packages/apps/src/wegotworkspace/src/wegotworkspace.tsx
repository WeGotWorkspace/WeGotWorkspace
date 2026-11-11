import { useMemo } from "react";
import { createMemoryHistory } from "@tanstack/react-router";
import { wegotworkspaceMockRoutes } from "@/wegotworkspace/src/wegotworkspace-mock-routes";
import { WeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-router";

export type WeGotWorkspaceProps = {
  /** Starting route (default sign-in). */
  initialPath?: string;
};

/**
 * Mock WeGotWorkspace shell for Storybook and offline demos (no live API).
 */
export function WeGotWorkspace({ initialPath = "/login" }: WeGotWorkspaceProps) {
  const history = useMemo(
    () =>
      createMemoryHistory({
        initialEntries: [initialPath],
      }),
    [initialPath],
  );

  return (
    <WeGotWorkspaceRouter mode="mock" history={history} mockRoutes={wegotworkspaceMockRoutes} />
  );
}
