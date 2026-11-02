import type { Locator, Page } from "@playwright/test";

/** The host's lobby banner, shown whenever someone is waiting to be admitted. */
export function meetLobby(page: Page): Locator {
  return page.getByRole("region", { name: /waiting in the lobby/ });
}

/** Admit the first person in the lobby (not "Admit all"). */
export async function admitFirstKnocker(page: Page): Promise<void> {
  await meetLobby(page)
    .getByRole("listitem")
    .first()
    .getByRole("button", { name: /^Admit / })
    .click();
}
