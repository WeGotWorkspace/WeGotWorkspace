import { useMemo } from "react";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";
import { contactsHiddenAddressBooks } from "@/contacts-core/src/contacts-view-prefs";
import { selectedProject } from "@/lib/projects/project-match";
import { useProjects } from "@/lib/projects/projects-store";
import { useProjectFilter } from "@/lib/projects/use-project-filter";

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

/** The owning Team of the selected Project, or null for "All Projects". */
export function useSelectedProjectTeamSlug(): string | null {
  const [filter] = useProjectFilter();
  const { projects } = useProjects();
  return selectedProject(filter, projects)?.teamSlug ?? null;
}

/**
 * Device-local hidden address-book set. Same localStorage algorithm as Notes/Tasks/Calendar.
 * The Project filter adds its hidden books on read only. The setter still works on the
 * stored set, so they are never saved and "All Projects" brings back what was shown.
 */
export function useContactsHiddenIds(books: ReadonlyArray<{ id: string }>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(books, contactsHiddenAddressBooks);
  const teamSlug = useSelectedProjectTeamSlug();
  const hiddenAddressBookIds = useMemo<ReadonlySet<string>>(() => {
    const byProject = addressBooksHiddenByProject(books, teamSlug);
    return byProject.size === 0 ? hiddenIds : new Set([...hiddenIds, ...byProject]);
  }, [books, hiddenIds, teamSlug]);
  return { hiddenAddressBookIds, setHiddenAddressBookIds: setHiddenIds };
}
