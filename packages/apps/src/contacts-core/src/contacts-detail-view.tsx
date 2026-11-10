import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Briefcase,
  Building2,
  Cake,
  Link2,
  MapPin,
  Network,
  StickyNote,
  UserRound,
} from "lucide-react";
import { ContactUserAvatar } from "./contact-user-avatar";
import {
  ContactAddressRows,
  ContactEmailRows,
  ContactPhoneRows,
  ContactUrlRows,
  contactAddressStreetInputId,
  contactChannelValueInputId,
} from "./contact-channel-editors";
import {
  DetailFieldAddButton,
  DetailFieldAddRow,
  DetailFieldList,
  DetailFieldRow,
} from "@/detail-field-row/src/detail-field-row";
import { DropdownMenu, type DropdownMenuItemProps } from "@/menu-dropdown/src/dropdown-menu";
import { Input } from "@/ui/input";
import { LocaleDatePicker } from "@/ui/locale-date-picker";
import { Switch } from "@/ui/switch";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import { cn } from "@/lib/utils";
import { TagGroup, type TagItem } from "@/tag/src/tag";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { groupAddressBookColor } from "@/contacts-core/src/contacts-addressbook-color";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import type { ContactDetailGroupChip } from "@/contacts-core/src/contacts-detail-groups";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  contactCardToEditDraft,
  emptyContactEditDraft,
  type ContactAddressDraft,
  type ContactChannelContext,
  type ContactEditDraft,
  type ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import { contactDisplayName } from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import { NoteDetailEyebrow } from "@/note-detail-view/src/note-detail-eyebrow";
import "@/note-detail-view/src/note-detail-view.css";

type ContactsDetailViewProps = {
  labels: ContactsUILabels;
  card?: ContactCard;
  createMode: boolean;
  /** No write rights on the card: the same sheet, display-only. */
  readOnly: boolean;
  /** The values being edited. Before it exists the sheet shows the card's own values. */
  editDraft: ContactEditDraft | null;
  displayName: string;
  onDraftChange: (patch: Partial<ContactEditDraft>) => void;
  onUpdatePhone: (id: string, number: string, phoneType?: ContactPhoneType) => void;
  onUpdateEmail: (id: string, address: string, contextType?: ContactChannelContext) => void;
  onUpdatePhoneContext: (id: string, phoneType: ContactPhoneType) => void;
  onUpdateEmailContext: (id: string, contextType: ContactChannelContext) => void;
  onUpdateAddress: (
    id: string,
    field: keyof Omit<ContactAddressDraft, "id" | "contextType">,
    value: string,
    contextType?: ContactChannelContext,
  ) => void;
  onUpdateAddressContext: (id: string, contextType: ContactChannelContext) => void;
  onUpdateUrl: (id: string, uri: string, contextType?: ContactChannelContext) => void;
  onUpdateUrlContext: (id: string, contextType: ContactChannelContext) => void;
  onRemoveUrl: (id: string) => void;
  onRemovePhone: (id: string) => void;
  onRemoveEmail: (id: string) => void;
  onRemoveAddress: (id: string) => void;
  /** Each adds an empty row and returns its id, so the sheet can focus it. */
  onAddPhone: () => string | undefined;
  onAddEmail: () => string | undefined;
  onAddAddress: () => string | undefined;
  onAddUrl: () => string | undefined;
  /** Above the name: the address book switcher (Notes-style eyebrow). */
  eyebrow?: ReactNode;
  /**
   * Group membership chips, washed in their address book's colour. Omit to hide:
   * group cards and create mode have no membership tags.
   */
  groupTags?: {
    assigned: ContactDetailGroupChip[];
    suggestions: ContactCard[];
    readonly: boolean;
    allowCreate: boolean;
    onAdd: (idOrLabel: string) => void;
    onRemove: (groupId: string) => void;
  };
  /** Locale for {@link LocaleDatePicker} (birthday). Default `en-US`. */
  locale?: string;
  className?: string;
};

/** Fields that stay out of sight while empty; "Add field" brings them in. */
type OptionalField = "middleName" | "jobTitle" | "department" | "birthday";

function optionalFieldHasValue(draft: ContactEditDraft, field: OptionalField): boolean {
  if (field === "middleName") return Boolean(draft.nameGiven2.trim());
  if (field === "jobTitle") return Boolean(draft.title.trim());
  if (field === "department") return Boolean(draft.department.trim());
  return Boolean(draft.birthday.trim());
}

function optionalFieldInputId(field: OptionalField): string {
  return `contact-field-${field}`;
}

function filled<T>(rows: T[], value: (row: T) => string): boolean {
  return rows.some((row) => value(row).trim());
}

function addressFilled(row: ContactAddressDraft): boolean {
  return [row.street, row.postalCode, row.locality, row.region, row.country].some((part) =>
    part.trim(),
  );
}

/** A group chip in its address book's colour: a light wash, the name mixed into ink. */
function groupTagColors(color: string | undefined): TagItem["colors"] {
  if (!color) return undefined;
  return {
    backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`,
    color: `color-mix(in oklch, ${color} 55%, var(--workspace-foreground))`,
  };
}

/**
 * A name part as wide as its text, so first, middle and last name read as one line:
 * in the title, or as ghost fields in a company's Name row. The hidden copy
 * (`data-value`) sizes it.
 */
function NamePartInput({
  id,
  value,
  placeholder,
  ariaLabel = placeholder,
  readOnly,
  autoFocus,
  variant = "title",
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  /** Defaults to the placeholder; set it when the placeholder is shortened. */
  ariaLabel?: string;
  readOnly: boolean;
  autoFocus?: boolean;
  variant?: "title" | "field";
  onChange: (value: string) => void;
}) {
  if (readOnly && !value.trim()) return null;
  const shared = {
    id,
    value,
    placeholder,
    "aria-label": ariaLabel,
    readOnly,
    autoFocus,
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  };
  return (
    <span
      className={cn(
        "contacts-detail-view__name-part",
        variant === "field" && "contacts-detail-view__name-part--field",
      )}
      data-value={value || placeholder}
    >
      {variant === "field" ? (
        <Input variant="ghost" size="sm" {...shared} />
      ) : (
        <input className="contacts-detail-view__name-input" {...shared} />
      )}
    </span>
  );
}

function SingleFieldInput({
  id,
  value,
  label,
  readOnly,
  onChange,
}: {
  id: string;
  value: string;
  label: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      variant="ghost"
      size="sm"
      aria-label={label}
      placeholder={label}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * The open contact, laid out like an open task or note (`NoteDetailView` sheet): the
 * address book above the name, the name as the title, its groups as tags, one row
 * per field, and the notes at the very bottom. Every change saves itself; there is
 * no separate edit mode. Rare fields stay hidden while empty ("Add field").
 */
export function ContactsDetailView({
  labels,
  card,
  createMode,
  readOnly,
  editDraft,
  displayName,
  onDraftChange,
  onUpdatePhone,
  onUpdateEmail,
  onUpdatePhoneContext,
  onUpdateEmailContext,
  onUpdateAddress,
  onUpdateAddressContext,
  onUpdateUrl,
  onUpdateUrlContext,
  onRemoveUrl,
  onRemovePhone,
  onRemoveEmail,
  onRemoveAddress,
  onAddPhone,
  onAddEmail,
  onAddAddress,
  onAddUrl,
  groupTags,
  eyebrow,
  locale = "en-US",
  className,
}: ContactsDetailViewProps) {
  const cardDraft = useMemo(
    () => (card ? contactCardToEditDraft(card) : emptyContactEditDraft()),
    [card],
  );
  const draft = editDraft ?? cardDraft;
  // Until the draft exists the values are the card's: nothing to type into yet.
  const locked = readOnly || !editDraft;
  const contactKey = createMode ? "create" : (card?.id ?? "");
  const [revealed, setRevealed] = useState<{ key: string; fields: OptionalField[] }>({
    key: contactKey,
    fields: [],
  });
  const revealedFields = revealed.key === contactKey ? revealed.fields : [];
  const [focusId, setFocusId] = useState<string | null>(null);
  // A field added from "Add field": the menu must not take focus back to its button.
  const menuFocusIdRef = useRef<string | null>(null);
  const overrides = useAddressBookColorOverrides();

  useLayoutEffect(() => {
    if (!focusId) return;
    const element = document.getElementById(focusId);
    if (!element) return;
    setFocusId(null);
    element.focus();
  }, [focusId, draft]);

  const isGroup = card?.kind === "group";
  const isCompany = draft.showAsCompany;
  const showField = (field: OptionalField) =>
    optionalFieldHasValue(draft, field) || (!locked && revealedFields.includes(field));
  // A company has no job title of its own.
  const fieldAvailable = (field: OptionalField) => !isGroup && !(isCompany && field === "jobTitle");

  const reveal = (field: OptionalField) => {
    setRevealed({ key: contactKey, fields: [...revealedFields, field] });
    if (field === "middleName") onDraftChange({ showGiven2: true });
    return optionalFieldInputId(field);
  };

  const addAndFocus = (add: () => string | undefined, inputId: (id: string) => string) => {
    const id = add();
    const target = id ? inputId(id) : null;
    setFocusId(target);
    return target;
  };

  const fromMenu = (target: string | null) => {
    menuFocusIdRef.current = target;
  };

  const optionalFields: Array<{ field: OptionalField; label: string; icon: ReactNode }> = [
    { field: "middleName", label: labels.nameGiven2, icon: <UserRound /> },
    { field: "jobTitle", label: labels.jobTitle, icon: <Briefcase /> },
    { field: "department", label: labels.jobDepartment, icon: <Network /> },
    { field: "birthday", label: labels.sectionBirthday, icon: <Cake /> },
  ];
  const addFieldItems: DropdownMenuItemProps[] = [
    ...optionalFields
      .filter(({ field }) => fieldAvailable(field) && !showField(field))
      .map(({ field, label, icon }) => ({
        id: field,
        label,
        icon,
        onClick: () => fromMenu(reveal(field)),
      })),
    ...(draft.addresses.length === 0
      ? [
          {
            id: "address",
            label: labels.address,
            icon: <MapPin />,
            onClick: () => fromMenu(addAndFocus(onAddAddress, contactAddressStreetInputId)),
          },
        ]
      : []),
    ...(draft.urls.length === 0
      ? [
          {
            id: "url",
            label: labels.urlAddress,
            icon: <Link2 />,
            onClick: () => fromMenu(addAndFocus(onAddUrl, contactChannelValueInputId)),
          },
        ]
      : []),
  ];

  const tags = groupTags?.assigned.map((chip): TagItem => ({
    id: chip.group.id,
    label: contactDisplayName(chip.group),
    icon: <ContactsGroupIcon />,
    removable: !groupTags.readonly && chip.writable,
    colors: groupTagColors(groupAddressBookColor(chip.group, overrides)),
  }));

  // Name and organisation, the rare fields, company: one block. Read-only and empty: none.
  const hasBasics =
    !isGroup &&
    (!locked ||
      Boolean(draft.organization.trim()) ||
      optionalFields.some(({ field }) => optionalFieldHasValue(draft, field)));

  /** Phones, e-mails, addresses, websites: each its own block, with room between. */
  const section = (show: boolean, rows: ReactNode) =>
    show ? (
      <DetailFieldList className="contacts-detail-view__fields">{rows}</DetailFieldList>
    ) : null;

  const optionalRow = (field: OptionalField, label: string, icon: ReactNode, control: ReactNode) =>
    showField(field) ? (
      <DetailFieldRow key={field} icon={icon} title={label}>
        {control}
      </DetailFieldRow>
    ) : null;

  /** First, middle (once it has a value or was added) and last name, on one line. */
  const nameParts = (variant: "title" | "field") => (
    <>
      <NamePartInput
        id="contact-given-name"
        variant={variant}
        value={draft.nameGiven}
        placeholder={labels.nameGiven}
        readOnly={locked}
        autoFocus={createMode && !isCompany}
        onChange={(nameGiven) => onDraftChange({ nameGiven })}
      />
      {showField("middleName") ? (
        <NamePartInput
          id={optionalFieldInputId("middleName")}
          variant={variant}
          value={draft.nameGiven2}
          placeholder={labels.nameGiven2Placeholder}
          ariaLabel={labels.nameGiven2}
          readOnly={locked}
          onChange={(nameGiven2) => onDraftChange({ nameGiven2, showGiven2: true })}
        />
      ) : null}
      <NamePartInput
        id="contact-surname"
        variant={variant}
        value={draft.nameSurname}
        placeholder={labels.nameSurname}
        readOnly={locked}
        onChange={(nameSurname) => onDraftChange({ nameSurname })}
      />
    </>
  );

  const title = isGroup ? (
    <h1 className="contacts-detail-view__title contacts-detail-view__title--static">
      {card ? contactDisplayName(card) : displayName}
    </h1>
  ) : (
    <h1 className="contacts-detail-view__title">
      {isCompany ? (
        <NamePartInput
          id="contact-organization"
          value={draft.organization}
          placeholder={labels.companyName}
          readOnly={locked}
          autoFocus={createMode}
          onChange={(organization) => onDraftChange({ organization })}
        />
      ) : (
        nameParts("title")
      )}
    </h1>
  );

  return (
    <article
      className={cn("contacts-detail-view note-detail-view paper-sheet", className)}
      style={{ "--contacts-detail-avatar-size": "4.5rem" } as CSSProperties}
    >
      <header className="contacts-detail-view__header">
        <ContactUserAvatar
          card={card}
          displayName={displayName}
          size="xl"
          compact
          className="contacts-detail-view__avatar"
        />
        <div className="contacts-detail-view__heading">
          <NoteDetailEyebrow>{eyebrow}</NoteDetailEyebrow>
          {title}
          {groupTags && tags ? (
            <TagGroup
              className="note-detail-view__tag-group contacts-detail-view__tag-group"
              size="lg"
              tags={tags}
              suggestions={groupTags.suggestions.map((group) => ({
                id: group.id,
                label: contactDisplayName(group),
                colors: groupTagColors(groupAddressBookColor(group, overrides)),
              }))}
              readonly={groupTags.readonly}
              allowCreate={groupTags.allowCreate}
              onAddTag={groupTags.readonly ? undefined : groupTags.onAdd}
              onRemoveTag={groupTags.readonly ? undefined : groupTags.onRemove}
              addPlaceholder={labels.addGroupPlaceholder}
              addAriaLabel={labels.addGroup}
              removeAriaLabelFor={(label) => `Remove group ${label}`}
            />
          ) : null}
        </div>
      </header>

      {hasBasics ? (
        <DetailFieldList className="contacts-detail-view__fields">
          {isCompany ? (
            <DetailFieldRow icon={<UserRound />} title={labels.sectionName}>
              <div className="contacts-detail-view__name-fields">{nameParts("field")}</div>
            </DetailFieldRow>
          ) : locked && !draft.organization.trim() ? null : (
            <DetailFieldRow icon={<Building2 />} title={labels.organizationName}>
              <SingleFieldInput
                id="contact-organization"
                value={draft.organization}
                label={labels.organizationName}
                readOnly={locked}
                onChange={(organization) => onDraftChange({ organization })}
              />
            </DetailFieldRow>
          )}
          {isGroup ? null : (
            <>
              {isCompany
                ? null
                : optionalRow(
                    "jobTitle",
                    labels.jobTitle,
                    <Briefcase />,
                    <SingleFieldInput
                      id={optionalFieldInputId("jobTitle")}
                      value={draft.title}
                      label={labels.jobTitle}
                      readOnly={locked}
                      onChange={(next) => onDraftChange({ title: next })}
                    />,
                  )}
              {optionalRow(
                "department",
                labels.jobDepartment,
                <Network />,
                <SingleFieldInput
                  id={optionalFieldInputId("department")}
                  value={draft.department}
                  label={labels.jobDepartment}
                  readOnly={locked}
                  onChange={(department) => onDraftChange({ department })}
                />,
              )}
              {optionalRow(
                "birthday",
                labels.sectionBirthday,
                <Cake />,
                <LocaleDatePicker
                  variant="ghost"
                  size="sm"
                  className="contacts-detail-view__birthday"
                  value={draft.birthday}
                  locale={locale}
                  label={labels.sectionBirthday}
                  placeholder={labels.sectionBirthday}
                  disabled={locked}
                  onChange={(birthday) => onDraftChange({ birthday })}
                />,
              )}
            </>
          )}
          {locked ? null : (
            <DetailFieldRow icon={<Building2 />} title={labels.companyContact} center>
              <Switch
                checked={draft.showAsCompany}
                onCheckedChange={(checked) => onDraftChange({ showAsCompany: checked })}
                aria-label={labels.companyContact}
              />
            </DetailFieldRow>
          )}
        </DetailFieldList>
      ) : null}

      {section(
        !locked || filled(draft.phones, (row) => row.number),
        <ContactPhoneRows
          phones={draft.phones}
          labels={labels}
          readOnly={locked}
          onAdd={() => addAndFocus(onAddPhone, contactChannelValueInputId)}
          onUpdatePhone={onUpdatePhone}
          onUpdatePhoneContext={onUpdatePhoneContext}
          onRemovePhone={onRemovePhone}
        />,
      )}
      {section(
        !locked || filled(draft.emails, (row) => row.address),
        <ContactEmailRows
          emails={draft.emails}
          labels={labels}
          readOnly={locked}
          onAdd={() => addAndFocus(onAddEmail, contactChannelValueInputId)}
          onUpdateEmail={onUpdateEmail}
          onUpdateEmailContext={onUpdateEmailContext}
          onRemoveEmail={onRemoveEmail}
        />,
      )}
      {section(
        draft.addresses.length > 0 && (!locked || draft.addresses.some(addressFilled)),
        <ContactAddressRows
          addresses={draft.addresses}
          labels={labels}
          readOnly={locked}
          onAdd={
            draft.addresses.length > 0
              ? () => addAndFocus(onAddAddress, contactAddressStreetInputId)
              : undefined
          }
          onUpdateAddress={onUpdateAddress}
          onUpdateAddressContext={onUpdateAddressContext}
          onRemoveAddress={onRemoveAddress}
        />,
      )}
      {section(
        !locked ? draft.urls.length > 0 : filled(draft.urls, (row) => row.uri),
        <ContactUrlRows
          urls={draft.urls}
          labels={labels}
          readOnly={locked}
          onAdd={
            draft.urls.length > 0
              ? () => addAndFocus(onAddUrl, contactChannelValueInputId)
              : undefined
          }
          onUpdateUrl={onUpdateUrl}
          onUpdateUrlContext={onUpdateUrlContext}
          onRemoveUrl={onRemoveUrl}
        />,
      )}

      {locked || addFieldItems.length === 0 ? null : (
        <DetailFieldList className="contacts-detail-view__fields">
          <DetailFieldAddRow>
            <DropdownMenu
              items={addFieldItems}
              onCloseAutoFocus={(event) => {
                const target = menuFocusIdRef.current;
                if (!target) return;
                menuFocusIdRef.current = null;
                event.preventDefault();
                // The page is inert while the menu is open: focus once it is not.
                requestAnimationFrame(() => document.getElementById(target)?.focus());
              }}
              trigger={<DetailFieldAddButton label={labels.addField} />}
            />
          </DetailFieldAddRow>
        </DetailFieldList>
      )}

      {locked && !draft.notes.trim() ? null : (
        <DetailFieldList className="contacts-detail-view__fields">
          <DetailFieldRow icon={<StickyNote />} title={labels.sectionNotes} stacked>
            <TextareaAutosize
              id="contact-notes"
              className="textarea textarea--size-sm textarea--ghost contacts-detail-view__notes"
              value={draft.notes}
              onChange={(event) => onDraftChange({ notes: event.target.value })}
              placeholder={labels.notesPlaceholder}
              aria-label={labels.sectionNotes}
              readOnly={locked}
              minRows={1}
              // Grows with the notes, however long: the pane scrolls, not the field.
              maxRows={Number.POSITIVE_INFINITY}
            />
          </DetailFieldRow>
        </DetailFieldList>
      )}
    </article>
  );
}
