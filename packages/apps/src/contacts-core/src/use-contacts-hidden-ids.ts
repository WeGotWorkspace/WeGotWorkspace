import { useMemo } from "react";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { contactsHiddenAddressBooks } from "@/contacts-core/src/contacts-view-prefs";
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
 * Address books the list leaves out: the device-local hidden set (same localStorage
 * algorithm as Notes/Tasks/Calendar) plus those the Project filter hides.
 */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const teamSlug = useSelectedProjectTeamSlug();
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(books, contactsHiddenAddressBooks);
  const hiddenAddressBookIds = useMemo(() => {
    const byProject = addressBooksHiddenByProject(books, teamSlug);
    return byProject.size === 0 ? hiddenIds : new Set([...hiddenIds, ...byProject]);
  }, [books, hiddenIds, teamSlug]);
  return { hiddenAddressBookIds, setHiddenAddressBookIds: setHiddenIds };
}
