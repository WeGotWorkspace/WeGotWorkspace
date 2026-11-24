import { useMemo } from "react";
import { useSelectedProjectTeamSlug } from "@/lib/projects/use-project-filter";

/** The Team address book of a Team: `group-{slug}` (server-set id). */
export function teamAddressBookId(teamSlug: string): string {
  return `group-${teamSlug}`;
}

/**
 * Address books the Project filter hides (#818 C3): with a Project selected, Contacts
 * shows only the owning Team's address book. Empty for "All Projects".
 */
export function addressBooksHiddenByProject(
  books: ReadonlyArray<{ id: string }>,
  teamSlug: string | null,
): ReadonlySet<string> {
  if (teamSlug === null) return new Set();
  const keep = teamAddressBookId(teamSlug);
  return new Set(books.map((book) => book.id).filter((id) => id !== keep));
}

/**
 * Address books the list leaves out: only those the Project filter hides. Address books
 * belong to a Team and have no show/hide switch of their own.
 */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const teamSlug = useSelectedProjectTeamSlug();
  const hiddenAddressBookIds = useMemo(
    () => addressBooksHiddenByProject(books, teamSlug),
    [books, teamSlug],
  );
  return { hiddenAddressBookIds };
}
