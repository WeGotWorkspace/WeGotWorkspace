import type { ReactNode } from "react";
import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import type { RescueOperations } from "@/lib/offline/core/rescue-parked-writes";

type Reason = ParkedWrite["reason"];

/**
 * The words of the rescue dialog. Each app writes its own, with its own noun
 * for a container (list, notebook, calendar, address book).
 */
export type RescueLabels = {
  /** Above the title when several containers wait: "List 1 of 2". */
  step: (step: number, total: number) => string;
  /** The dialog title: "2 tasks from “Groceries”". */
  title: (count: number, containerName: string) => string;
  /** Why the writes could not be saved there, and that the person chooses. */
  reason: (containerName: string, reason: Reason) => string;
  /** Added to the reason when an offline edit is among them: it comes back as a new item. */
  editsAsNew: string;
  /** "Move to" */
  destinationLabel: string;
  /** The menu choice for a new container: "New list". */
  newContainer: string;
  /** "Name of the new list" */
  newContainerLabel: string;
  /**
   * The suggested name for a new container: the same name when the old one is
   * gone, "<name> (copy)" when it is still there but view-only.
   */
  newContainerName: (containerName: string, reason: Reason) => string;
  move: (count: number) => string;
  discard: (count: number) => string;
  later: string;
  /** The header button that reopens the dialog: "Tasks need a new list". */
  entry: (containers: number) => string;
  moved: (count: number, containerName: string) => string;
  discarded: (count: number) => string;
  failed: string;
  /** Another tab already shows the dialog. */
  openElsewhere: string;
};

/** A container a rescued item can go to. Apps pass their own type. */
export type RescueContainer = { id: string; name: string };

/** How an app's containers look in the rescue dialog and its header button. */
export type RescueView<C extends RescueContainer> = {
  labels: RescueLabels;
  /** The app's dialog surface class, which carries its theme tokens (`tasks-dialog-surface`). */
  surfaceClassName: string;
  /** The container's glyph in the "Move to" menu. */
  containerIcon: (container: C) => ReactNode;
  /** The glyph on the header button. */
  entryIcon: ReactNode;
};

/**
 * One app's side of the shared rescue (#1565): its parked-writes domain, the
 * containers it has, which of them take new items, and how to make a
 * container and an item in it.
 */
export type RescueAdapter<T, C extends RescueContainer> = RescueView<C> & {
  domain: string;
  containers: C[];
  canWrite: (container: C) => boolean;
  /** Undefined until the app can write (no API yet): Move then does nothing. */
  operations?: RescueOperations<T>;
  /** After each move or discard: reread the cache and tell the app's other tabs. */
  afterSettle?: () => Promise<void>;
};
