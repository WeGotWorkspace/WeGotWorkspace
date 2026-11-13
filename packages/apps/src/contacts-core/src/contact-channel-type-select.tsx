import { Select, SelectContent, SelectItem } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import type { ContactChannelContext, ContactPhoneType } from "@/lib/models/contacts-edit-draft";
import {
  channelSelectValue,
  channelValueFromSelect,
  contactChannelContextSelectOptions,
  contactPhoneTypeSelectOptions,
  type ContactChannelTypeLabels,
  type ContactPhoneTypeLabels,
} from "@/contacts-core/src/contacts-channel-select";

const CONTEXT_SELECT_CLASS = "contacts-detail-view__context-select";
const CONTEXT_SELECT_MENU_CLASS =
  "contacts-detail-view__context-menu collection-ghost-select__menu";

type ContactChannelTypeSelectProps<T extends string> = {
  value: T | "";
  options: ReturnType<typeof contactChannelContextSelectOptions>;
  onChange: (value: T | "") => void;
  ariaLabel: string;
  disabled?: boolean;
};

/**
 * A channel's type (Mobile, Home, Work…) in the label column of its detail row: the
 * suite ghost dropdown, as the Tasks field dropdowns.
 */
function ContactChannelTypeSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: ContactChannelTypeSelectProps<T>) {
  const selected = channelSelectValue(value);
  const label = options.find((option) => option.value === selected)?.label ?? "";
  return (
    <Select
      value={selected}
      onValueChange={(next) => onChange(channelValueFromSelect<T>(next))}
      disabled={disabled}
    >
      <CollectionGhostSelectTrigger
        className={CONTEXT_SELECT_CLASS}
        aria-label={ariaLabel}
        disabled={disabled}
        label={label}
      />
      <SelectContent className={CONTEXT_SELECT_MENU_CLASS}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ContactContextTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  labels: ContactChannelTypeLabels;
  value: ContactChannelContext;
  onChange: (value: ContactChannelContext) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <ContactChannelTypeSelect
      value={value}
      options={contactChannelContextSelectOptions(labels)}
      ariaLabel={ariaLabel}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

export function ContactPhoneTypeSelect({
  labels,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  labels: ContactPhoneTypeLabels;
  value: ContactPhoneType;
  onChange: (value: ContactPhoneType) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <ContactChannelTypeSelect
      value={value}
      options={contactPhoneTypeSelectOptions(labels)}
      ariaLabel={ariaLabel}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
