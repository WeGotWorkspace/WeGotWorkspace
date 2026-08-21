import type { Preview } from "@storybook/react-vite";
import { Fragment, createElement } from "react";
import { DEFAULT_VIEWPORT, MINIMAL_VIEWPORTS, responsiveViewport } from "storybook/viewport";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import "../src/styles.css";
import { AppToaster } from "../src/ui/sonner";
import { TooltipProvider } from "../src/ui/tooltip";

const preview: Preview = {
  tags: ["autodocs"],
  decorators: [
    (Story, context) => {
      if (context.parameters.wegotworkspaceRouter) {
        return createElement(Fragment, null, createElement(Story), createElement(AppToaster));
      }

      const initialPath = (context.parameters.routerPath as string) ?? "/notes";

      const rootRoute = createRootRoute({
        component: () => createElement(Outlet),
      });

      const renderStory = () => createElement(Story);
      const routes = [
        createRoute({ getParentRoute: () => rootRoute, path: "/", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "login", component: renderStory }),
        createRoute({
          getParentRoute: () => rootRoute,
          path: "login/forgot",
          component: renderStory,
        }),
        createRoute({
          getParentRoute: () => rootRoute,
          path: "login/reset",
          component: renderStory,
        }),
        createRoute({ getParentRoute: () => rootRoute, path: "notes", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "mail", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "drive", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "install", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "settings", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "meet", component: renderStory }),
        createRoute({ getParentRoute: () => rootRoute, path: "admin", component: renderStory }),
      ];

      const routeTree = rootRoute.addChildren(routes);
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: [initialPath] }),
      });

      return createElement(
        Fragment,
        null,
        createElement(RouterProvider, { router }),
        createElement(AppToaster),
      );
    },
    (Story) => createElement(TooltipProvider, { delayDuration: 150 }, createElement(Story)),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      options: {
        [DEFAULT_VIEWPORT]: responsiveViewport,
        ...MINIMAL_VIEWPORTS,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations (Storybook Vitest smoke sets STORYBOOK_VITEST_SMOKE=1)
      // 'off' - skip a11y checks entirely
      test: import.meta.env.STORYBOOK_A11Y_GATE === "1" ? "error" : "todo",
    },
    docs: {
      codePanel: true,
      source: {
        type: "code",
        excludeDecorators: true,
      },
    },
  },
  initialGlobals: {
    viewport: { value: DEFAULT_VIEWPORT, isRotated: false },
  },
};

export default preview;
