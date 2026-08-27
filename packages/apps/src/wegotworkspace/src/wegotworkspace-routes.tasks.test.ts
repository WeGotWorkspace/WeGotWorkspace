import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";
import { INBOX_TASK_LIST_ID } from "@/tasks-core/src/tasks-task-utils";

describe("wegotworkspace tasks routes", () => {
  it("matches listId on direct /tasks/lists/:listId loads", async () => {
    const history = createMemoryHistory({
      initialEntries: [`/tasks/lists/${INBOX_TASK_LIST_ID}`],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const listMatch = router.state.matches.find((match) => match.params.listId);
    expect(listMatch?.params).toMatchObject({
      listId: INBOX_TASK_LIST_ID,
    });
  });

  it("registers /tasks with a beforeLoad redirect", () => {
    const history = createMemoryHistory({
      initialEntries: ["/tasks/state/all"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    const route = router.routesByPath["/tasks"];
    expect(route?.options.beforeLoad).toEqual(expect.any(Function));
    expect(() => route?.options.beforeLoad?.({} as never)).toThrow();
  });

  it("matches state slug on /tasks/state/:stateSlug deep links", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/tasks/state/today"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const stateMatch = router.state.matches.find((match) => match.params.stateSlug);
    expect(stateMatch?.params).toMatchObject({
      stateSlug: "today",
    });
  });
});
