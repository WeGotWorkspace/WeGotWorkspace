import {
  defaultPickerCalendarId,
  writableCalendarsForPicker,
  type CalendarPickerCalendar,
} from "@/lib/calendar-event-calendar-picker";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { CollectionSelect } from "@/ui/collection-select";

/**
 * The default collection of an app (calendar, list, address book, notebook) as the
 * suite's ghost collection picker. Only collections the user may write to are offered.
 */
export function SettingsCollectionSelect({
  collections,
  value,
  label,
  onValueChange,
}: {
  collections: CalendarPickerCalendar[];
  value: string | undefined;
  label: string;
  onValueChange: (id: string) => void;
}) {
  const writable = writableCalendarsForPicker(collections);
  const selectedId = defaultPickerCalendarId(collections, value || undefined);
  const selected = writable.find((collection) => collection.id === selectedId);
  if (!selected) return null;
  return (
    <CollectionSelect
      items={writable}
      value={selected.id}
      dot={<CollectionColorDot />}
      color={selected.color}
      triggerLabel={selected.name}
      accessibleName={label}
      triggerVariant="ghost"
      menuClassName="collection-ghost-select__menu"
      onValueChange={onValueChange}
    />
  );
}
