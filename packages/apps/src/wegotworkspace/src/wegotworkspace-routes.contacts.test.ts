import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { createMockWeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-mock-routes";

describe("wegotworkspace contacts routes", () => {
  it("matches contactId on direct /contacts/all/:contactId loads", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/contacts/all/ddeec682-7526-42ea-8e4e-ce0e72b26e70"],
    });
    const router = createMockWeGotWorkspaceRouter(history);
    await router.load();

    const contactMatch = router.state.matches.find((match) => match.params.contactId);
    expect(contactMatch?.params).toMatchObject({
      contactId: "ddeec682-7526-42ea-8e4e-ce0e72b26e70",
    });
  });

  it("matches group and contact params on group deep links", async () => {
    const history = createMemoryHistory({
      initialEntries: ["/contacts/groups/group-1/contact-2"],
    });
    const router = createMockWeGotWorkspaceRouter(history);
    await router.load();

    const groupMatch = router.state.matches.find((match) => match.params.groupCardId);
    expect(groupMatch?.params).toMatchObject({
      groupCardId: "group-1",
      contactId: "contact-2",
    });
  });
});
