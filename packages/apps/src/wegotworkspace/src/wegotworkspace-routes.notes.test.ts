import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-routes";

describe("wegotworkspace notes routes", () => {
  it("matches noteId on direct /notes/all/:noteId loads", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/notes/all/n-123"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const noteMatch = router.state.matches.find((match) => match.params.noteId);
    expect(noteMatch?.params).toMatchObject({ noteId: "n-123" });
  });

  it("navigates from /notes/all to /notes/all/:noteId without full reload", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/notes/all"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "live", history });
    await router.load();
    expect(router.state.location.pathname).toBe("/notes/all");

    await router.navigate({
      to: "/notes/all/$noteId",
      params: { noteId: "n-1" },
    });

    expect(router.state.location.pathname).toBe("/notes/all/n-1");
    const noteMatch = router.state.matches.find((match) => match.params.noteId);
    expect(noteMatch?.params).toMatchObject({ noteId: "n-1" });
  });

  it("navigates filter views from list path to note path", async () => {
    for (const view of ["all", "starred", "archive", "shared-with-me"] as const) {
      const history = createMemoryHistory({
        initialEntries: [`/notes/${view}`],
      });
      const router = createWeGotWorkspaceRouter({ mode: "mock", history });
      await router.load();
      expect(router.state.location.pathname).toBe(`/notes/${view}`);

      await router.navigate({
        to: `/notes/${view}/$noteId`,
        params: { noteId: "n-1" },
      });
      expect(router.state.location.pathname).toBe(`/notes/${view}/n-1`);
    }
  });

  it("round-trips shared-with-me note ids that contain path separators", async () => {
    const noteId = "swm:users/bob/.notes/Drafts/n-1.md";
    const history = createMemoryHistory({
      initialEntries: ["/notes/shared-with-me"],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    await router.navigate({
      to: "/notes/shared-with-me/$noteId",
      params: { noteId },
    });

    // TanStack encodes the param; decoded params.noteId stays the original id.
    expect(router.state.location.pathname).toBe(
      `/notes/shared-with-me/${encodeURIComponent(noteId)}`,
    );
    const noteMatch = router.state.matches.find((match) => match.params.noteId);
    expect(noteMatch?.params.noteId).toBe(noteId);
  });

  it("matches local temp note ids on All notes deep links", async () => {
    const noteId = "local-9a8c070a270341c394678504240799ee";
    const history = createMemoryHistory({
      initialEntries: [`/notes/all/${noteId}`],
    });
    const router = createWeGotWorkspaceRouter({ mode: "mock", history });
    await router.load();

    const noteMatch = router.state.matches.find((match) => match.params.noteId);
    expect(noteMatch?.params).toMatchObject({ noteId });
  });

  it("matches archive and notebook params on deep links", async () => {
    const archiveHistory = createMemoryHistory({
      initialEntries: ["/notes/archive/n-456"],
    });
    const archiveRouter = createWeGotWorkspaceRouter({ mode: "mock", history: archiveHistory });
    await archiveRouter.load();

    const archiveMatch = archiveRouter.state.matches.find((match) =>
      match.pathname.includes("/archive"),
    );
    expect(archiveMatch?.params).toMatchObject({ noteId: "n-456" });

    const notebookHistory = createMemoryHistory({
      initialEntries: ["/notes/Drafts/n-789"],
    });
    const notebookRouter = createWeGotWorkspaceRouter({ mode: "mock", history: notebookHistory });
    await notebookRouter.load();

    const notebookMatch = notebookRouter.state.matches.find((match) => match.params.notebookSlug);
    expect(notebookMatch?.params).toMatchObject({
      notebookSlug: "Drafts",
      noteId: "n-789",
    });
  });
});
