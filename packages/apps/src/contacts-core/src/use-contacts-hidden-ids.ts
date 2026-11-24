import { useMemo } from "react";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { contactsHiddenAddressBooks } from "@/contacts-core/src/contacts-view-prefs";
import { isPersonalFilter } from "@/lib/projects/project-filter";
import { useProjectFilter, useSelectedProjectTeamSlug } from "@/lib/projects/use-project-filter";

/** The Team address book of a Team: `group-{slug}` (server-set id). */
export function teamAddressBookId(teamSlug: string): string {
  return `group-${teamSlug}`;
}

/**
 * Address books the Project filter hides (#818 C3). A Team or a selected Project keeps only
 * the owning Team's address book; Personal drops every Team address book (`group-*`) and
 * keeps the rest; All Teams hides nothing.
 */
export function addressBooksHiddenByProject(
  books: ReadonlyArray<{ id: string }>,
  teamSlug: string | null,
  personal = false,
): ReadonlySet<string> {
  if (teamSlug !== null) {
    const keep = teamAddressBookId(teamSlug);
    return new Set(books.map((book) => book.id).filter((id) => id !== keep));
  }
  if (personal) {
    return new Set(books.map((book) => book.id).filter((id) => id.startsWith("group-")));
  }
  return new Set();
}

/** The view to show instead: "all" when `view` is a `book:{id}` the Project filter hides. */
export function viewAfterProjectFilter(
  view: string,
  projectHidden: ReadonlySet<string>,
  groupBookId?: string,
): string {
  const bookId = view.startsWith("book:") ? view.slice("book:".length) : groupBookId;
  return bookId !== undefined && projectHidden.has(bookId) ? "all" : view;
}

/** The address books the Project filter currently hides. */
export function useContactsProjectHiddenIds(
  books: ReadonlyArray<{ id: string }>,
): ReadonlySet<string> {
  const teamSlug = useSelectedProjectTeamSlug();
  const [filter] = useProjectFilter();
  const personal = isPersonalFilter(filter);
  return useMemo(
    () => addressBooksHiddenByProject(books, teamSlug, personal),
    [books, teamSlug, personal],
  );
}

/**
 * Address books the list leaves out: the device-local hidden set (same localStorage
 * algorithm as Notes/Tasks/Calendar) plus those the Project filter hides.
 */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(books, contactsHiddenAddressBooks);
  const projectHiddenAddressBookIds = useContactsProjectHiddenIds(books);
  const hiddenAddressBookIds = useMemo(
    () =>
      projectHiddenAddressBookIds.size === 0
        ? hiddenIds
        : new Set([...hiddenIds, ...projectHiddenAddressBookIds]),
    [hiddenIds, projectHiddenAddressBookIds],
  );
  return {
    hiddenAddressBookIds,
    projectHiddenAddressBookIds,
    setHiddenAddressBookIds: setHiddenIds,
  };
}
