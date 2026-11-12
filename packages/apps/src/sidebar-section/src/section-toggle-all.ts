import type { VisibilityDotChecked } from "@/collection-sidebar/src/visibility-dot";

/** The "All" row first in a section: a neutral dot that shows or hides every row of it. */
export type SidebarSectionToggleAll = {
  /** All rows on, none on, or `"mixed"`. */
  checked: VisibilityDotChecked;
  /** The row's name; default "All". */
  name?: string;
  /** Accessible name for what a click does, e.g. "Show all reminders". */
  label: string;
  onToggle: () => void;
};

/** Whether all, none or some of `ids` are on. An empty list reads as off. */
export function visibilityOfAll(
  ids: readonly string[],
  isOn: (id: string) => boolean,
): VisibilityDotChecked {
  let on = 0;
  for (const id of ids) if (isOn(id)) on += 1;
  if (on === 0) return false;
  return on === ids.length ? true : "mixed";
}

/**
 * The "All" row for a section's rows: shows all while some or none are on, hides
 * all while all are on. No row (undefined) when there are no rows.
 */
export function sectionToggleAll({
  ids,
  isOn,
  onSetAll,
  showLabel,
  hideLabel,
}: {
  ids: readonly string[];
  isOn: (id: string) => boolean;
  onSetAll: (on: boolean) => void;
  showLabel: string;
  hideLabel: string;
}): SidebarSectionToggleAll | undefined {
  if (ids.length === 0) return undefined;
  const checked = visibilityOfAll(ids, isOn);
  const turnOn = checked !== true;
  return { checked, label: turnOn ? showLabel : hideLabel, onToggle: () => onSetAll(turnOn) };
}

/** `current` with every id in `ids` added (`present`) or removed. */
export function withIds(
  current: ReadonlySet<string>,
  ids: readonly string[],
  present: boolean,
): Set<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (present) next.add(id);
    else next.delete(id);
  }
  return next;
}
