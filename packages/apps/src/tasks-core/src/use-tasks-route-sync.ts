import { useCallback, useMemo } from "react";
import { useLocation, useParams, useRouter } from "@tanstack/react-router";
import {
  isTasksPathname,
  tasksNavigateTarget,
  tasksViewFromLocation,
  type TasksRouteParams,
} from "@/tasks-core/src/tasks-route-search";

/** Sync tasks workspace view with path-based `/tasks/...` routes. */
export function useTasksRouteSync() {
  const router = useRouter();
  const location = useLocation();
  const params = useParams({ strict: false }) as TasksRouteParams;

  const initialView = useMemo(
    () =>
      isTasksPathname(location.pathname)
        ? tasksViewFromLocation(location.pathname, params)
        : undefined,
    [location.pathname, params],
  );

  const handleViewChange = useCallback(
    (view: string) => {
      const livePath = router.state.location.pathname;
      // Leaving tasks (app switcher, back) must not rewrite the new app onto
      // `/tasks/...`. Parse treats foreign paths as the All Lists default.
      if (!isTasksPathname(livePath)) return;
      const routeView = tasksViewFromLocation(livePath, params);
      if (view === routeView) return;
      const target = tasksNavigateTarget(view);
      void router.navigate({ ...target, replace: true });
    },
    [params, router],
  );

  return {
    initialView,
    handleViewChange,
  };
}
