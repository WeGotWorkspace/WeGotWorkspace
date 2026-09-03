import type { ReactNode } from "react";
import { ContactUserAvatar } from "./contact-user-avatar";
import {
  ContactAddressRows,
  ContactEmailRows,
  ContactPhoneRows,
  ContactUrlRows,
} from "./contact-channel-editors";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";
import { Tag, TagGroup, type TagItem } from "@/tag/src/tag";
import { groupAddressBookColor } from "@/contacts-core/src/contacts-addressbook-color";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import type { ContactDetailGroupChip } from "@/contacts-core/src/contacts-detail-groups";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import type {
  ContactAddressDraft,
  ContactChannelContext,
  ContactEditDraft,
  ContactPhoneType,
} from "@/contacts-core/src/contacts-edit-utils";
import {
  contactDisplayName,
  contactListSubtitle,
  contactPersonName,
  channelDisplayLabels,
  contactBirthdayDisplay,
  contactPhoneDisplayValue,
  mapEntriesSorted,
  phoneToTelHref,
  safeContactExternalHref,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

type ContactsDetailViewProps = {
  labels: ContactsUILabels;
  card?: ContactCard;
  createMode: boolean;
  editMode: boolean;
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
  /**
   * Group membership chips (Notes TagGroup). Omit to hide — group cards and
   * create-mode have no membership tags.
   */
  groupTags?: {
    assigned: ContactDetailGroupChip[];
    suggestions: ContactCard[];
    readonly: boolean;
    allowCreate: boolean;
    onAdd: (idOrLabel: string) => void;
    onRemove: (groupId: string) => void;
  };
  className?: string;
};

function groupToTagItem(
  chip: ContactDetailGroupChip,
  removable: boolean,
  colorOverrides: Record<string, string>,
): TagItem {
  const { group } = chip;
  return {
    id: group.id,
    label: contactDisplayName(group),
    icon: <ContactsGroupIcon book={group} />,
    collectionTint: groupAddressBookColor(group, colorOverrides),
    removable,
  };
}

type AddressDisplayLines = {
  street: string;
  localityLine: string;
  region: string;
  country: string;
};

function readAddressComponentValue(
  components: NonNullable<ContactCard["addresses"]>[string]["components"],
  kind: string,
): string {
  return (components ?? [])
    .filter((component) => component.kind === kind)
    .map((component) => component.value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function readLegacyAddressField(
  address: NonNullable<ContactCard["addresses"]>[string],
  field: "street" | "locality" | "region" | "postcode" | "country",
): string {
  const value = (address as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function readCardAddressStreet(address: NonNullable<ContactCard["addresses"]>[string]): string {
  const components = address.components ?? [];
  const name = readAddressComponentValue(components, "name");
  const number = readAddressComponentValue(components, "number");
  if (number && name) return `${number} ${name}`.trim();
  if (name) return name;
  if (number) return number;
  const legacyStreet = readLegacyAddressField(address, "street");
  if (legacyStreet) return legacyStreet;
  if (typeof address.full === "string" && address.full.trim()) return address.full.trim();
  const fromComponents = components
    .map((part) => part.value?.trim())
    .filter(Boolean)
    .join(", ");
  return fromComponents;
}

function formatLocalityLine(postalCode: string, locality: string): string {
  return [postalCode, locality]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function addressDisplayFromCard(
  address: NonNullable<ContactCard["addresses"]>[string],
): AddressDisplayLines {
  const components = address.components ?? [];
  return {
    street: readCardAddressStreet(address),
    localityLine: formatLocalityLine(
      readAddressComponentValue(components, "postcode") ||
        readLegacyAddressField(address, "postcode"),
      readAddressComponentValue(components, "locality") ||
        readLegacyAddressField(address, "locality"),
    ),
    region:
      readAddressComponentValue(components, "region") || readLegacyAddressField(address, "region"),
    country:
      readAddressComponentValue(components, "country") ||
      readLegacyAddressField(address, "country"),
  };
}

function AddressDisplayBlock({ lines }: { lines: AddressDisplayLines }) {
  const rows = [lines.street, lines.localityLine, lines.region, lines.country].filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <div className="contacts-detail-view__address-lines">
      {lines.street ? <span>{lines.street}</span> : null}
      {lines.localityLine ? <span>{lines.localityLine}</span> : null}
      {lines.region ? <span>{lines.region}</span> : null}
      {lines.country ? <span>{lines.country}</span> : null}
    </div>
  );
}

function ChannelReadRow({
  contextLabels,
  emptyLabel,
  children,
}: {
  contextLabels?: string[];
  emptyLabel?: string;
  children: ReactNode;
}) {
  const hasLabels = Boolean(contextLabels?.length);
  return (
    <li className="contacts-detail-view__channel-row">
      {hasLabels ? (
        <div className="contacts-detail-view__channel-type">
          {contextLabels?.map((label, index) => (
            <Tag key={`${label}-${index}`} label={label} />
          ))}
        </div>
      ) : emptyLabel ? (
        <div className="contacts-detail-view__channel-type">
          <span className="contacts-detail-view__label--none">{emptyLabel}</span>
        </div>
      ) : (
        <span className="contacts-detail-view__channel-type" aria-hidden="true" />
      )}
      <div className="contacts-detail-view__channel-value">{children}</div>
    </li>
  );
}

function contactViewIdentityLines(card: ContactCard): string[] {
  if (card.kind === "group") return [];
  const organization = mapEntriesSorted(card.organizations)[0]?.[1]?.name;
  const jobTitleEntry =
    mapEntriesSorted(card.titles).find(([, title]) => (title.kind ?? "title") === "title") ??
    mapEntriesSorted(card.titles)[0];
  const jobTitle = jobTitleEntry?.[1]?.name?.trim() ?? "";
  const jobDepartment = mapEntriesSorted(card.organizations)[0]?.[1]?.units?.[0]?.name;
  const orgName = typeof organization === "string" ? organization.trim() : "";
  const deptName = typeof jobDepartment === "string" ? jobDepartment.trim() : "";
  const lines: string[] = [];
  if (card.kind === "org") {
    const subtitle = contactListSubtitle(card);
    if (subtitle) lines.push(subtitle);
    if (jobTitle) lines.push(jobTitle);
    if (deptName) lines.push(deptName);
    return lines;
  }
  if (jobTitle) lines.push(jobTitle);
  const orgLine = [deptName, orgName].filter(Boolean).join(" · ");
  if (orgLine) lines.push(orgLine);
  return lines;
}

function DetailSection({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <section className="contacts-detail-view__section">
      <h2 className="contacts-detail-view__section-title">{title}</h2>
      <div className="contacts-detail-view__section-body">{children}</div>
    </section>
  );
}

type ContactsDetailEditFormProps = {
  labels: ContactsUILabels;
  card?: ContactCard;
  editDraft: ContactEditDraft;
  onDraftChange: (patch: Partial<ContactEditDraft>) => void;
  onUpdatePhone: ContactsDetailViewProps["onUpdatePhone"];
  onUpdateEmail: ContactsDetailViewProps["onUpdateEmail"];
  onUpdatePhoneContext: ContactsDetailViewProps["onUpdatePhoneContext"];
  onUpdateEmailContext: ContactsDetailViewProps["onUpdateEmailContext"];
  onUpdateAddress: ContactsDetailViewProps["onUpdateAddress"];
  onUpdateAddressContext: ContactsDetailViewProps["onUpdateAddressContext"];
  onUpdateUrl: ContactsDetailViewProps["onUpdateUrl"];
  onUpdateUrlContext: ContactsDetailViewProps["onUpdateUrlContext"];
  onRemoveUrl: ContactsDetailViewProps["onRemoveUrl"];
  onRemovePhone: ContactsDetailViewProps["onRemovePhone"];
  onRemoveEmail: ContactsDetailViewProps["onRemoveEmail"];
  onRemoveAddress: ContactsDetailViewProps["onRemoveAddress"];
};

function ContactsDetailEditForm({
  labels,
  card,
  editDraft,
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
}: ContactsDetailEditFormProps) {
  const showAsCompany = editDraft.showAsCompany;
  const showBirthdayEditor = card?.kind !== "group";
  const nameFields = (
    <>
      <div className="contacts-detail-view__name-row">
        <FieldLabelRow label={labels.nameGiven} htmlFor="contact-given-name">
          <Input
            id="contact-given-name"
            value={editDraft.nameGiven}
            onChange={(event) => onDraftChange({ nameGiven: event.target.value })}
          />
        </FieldLabelRow>
        <FieldLabelRow label={labels.nameSurname} htmlFor="contact-surname">
          <Input
            id="contact-surname"
            value={editDraft.nameSurname}
            onChange={(event) => onDraftChange({ nameSurname: event.target.value })}
          />
        </FieldLabelRow>
      </div>
      {editDraft.showGiven2 ? (
        <FieldLabelRow label={labels.nameGiven2} htmlFor="contact-given2-name">
          <Input
            id="contact-given2-name"
            value={editDraft.nameGiven2}
            onChange={(event) => onDraftChange({ nameGiven2: event.target.value })}
          />
        </FieldLabelRow>
      ) : null}
    </>
  );
  const organizationField = (
    <FieldLabelRow label={labels.organizationName} htmlFor="contact-organization">
      <Input
        id="contact-organization"
        value={editDraft.organization}
        onChange={(event) => onDraftChange({ organization: event.target.value })}
      />
    </FieldLabelRow>
  );
  const jobFields = (
    <div className="contacts-detail-view__job-row">
      <FieldLabelRow label={labels.jobTitle} htmlFor="contact-job-title">
        <Input
          id="contact-job-title"
          value={editDraft.title}
          onChange={(event) => onDraftChange({ title: event.target.value })}
        />
      </FieldLabelRow>
      <FieldLabelRow label={labels.jobDepartment} htmlFor="contact-job-department">
        <Input
          id="contact-job-department"
          value={editDraft.department}
          onChange={(event) => onDraftChange({ department: event.target.value })}
        />
      </FieldLabelRow>
    </div>
  );
  const birthdayField = showBirthdayEditor ? (
    <FieldLabelRow label={labels.sectionBirthday} htmlFor="contact-birthday">
      <Input
        id="contact-birthday"
        type="date"
        size="md"
        autoComplete="bday"
        value={editDraft.birthday}
        onChange={(event) => onDraftChange({ birthday: event.target.value })}
      />
    </FieldLabelRow>
  ) : null;
  const companyToggle = (
    <FieldLabelRow label={labels.companyContact}>
      <Switch
        checked={editDraft.showAsCompany}
        onCheckedChange={(checked) => onDraftChange({ showAsCompany: checked })}
        aria-label={labels.companyContact}
      />
    </FieldLabelRow>
  );

  return (
    <>
      <DetailSection title={labels.sectionName}>
        <div className="contacts-detail-view__field-stack">
          {showAsCompany ? (
            <>
              {organizationField}
              {nameFields}
              {jobFields}
              {companyToggle}
              {birthdayField}
            </>
          ) : (
            <>
              {nameFields}
              {jobFields}
              {organizationField}
              {companyToggle}
              {birthdayField}
            </>
          )}
        </div>
      </DetailSection>
      <DetailSection title={labels.sectionPhones}>
        <div className="contacts-detail-view__editable-list">
          <ContactPhoneRows
            phones={editDraft.phones}
            labels={labels}
            onUpdatePhone={onUpdatePhone}
            onUpdatePhoneContext={onUpdatePhoneContext}
            onRemovePhone={onRemovePhone}
          />
        </div>
      </DetailSection>
      <DetailSection title={labels.sectionEmails}>
        <div className="contacts-detail-view__editable-list">
          <ContactEmailRows
            emails={editDraft.emails}
            labels={labels}
            onUpdateEmail={onUpdateEmail}
            onUpdateEmailContext={onUpdateEmailContext}
            onRemoveEmail={onRemoveEmail}
          />
        </div>
      </DetailSection>
      <DetailSection title={labels.sectionAddresses}>
        <div className="contacts-detail-view__editable-list contacts-detail-view__address-list">
          <ContactAddressRows
            addresses={editDraft.addresses}
            labels={labels}
            onUpdateAddress={onUpdateAddress}
            onUpdateAddressContext={onUpdateAddressContext}
            onRemoveAddress={onRemoveAddress}
          />
        </div>
      </DetailSection>
      <DetailSection title={labels.sectionUrls}>
        <div className="contacts-detail-view__editable-list">
          <ContactUrlRows
            urls={editDraft.urls}
            labels={labels}
            onUpdateUrl={onUpdateUrl}
            onUpdateUrlContext={onUpdateUrlContext}
            onRemoveUrl={onRemoveUrl}
          />
        </div>
      </DetailSection>
      <DetailSection title={labels.sectionNotes}>
        <Textarea
          id="contact-notes"
          className="contacts-detail-view__notes"
          aria-label={labels.sectionNotes}
          value={editDraft.notes}
          onChange={(event) => onDraftChange({ notes: event.target.value })}
        />
      </DetailSection>
    </>
  );
}

function ContactsDetailReadBody({
  labels,
  card,
}: {
  labels: ContactsUILabels;
  card?: ContactCard;
}) {
  const personName = card ? contactPersonName(card) : "";
  const notes = mapEntriesSorted(card?.notes)[0]?.[1]?.note;
  const notesText = typeof notes === "string" ? notes.trim() : "";
  const birthdayDisplay = card ? contactBirthdayDisplay(card) : "";
  const readPhones = mapEntriesSorted(card?.phones).map(([id, phone]) => ({
    id,
    number: contactPhoneDisplayValue(phone),
    contextLabels: channelDisplayLabels(phone.contexts, labels, {
      features: phone.features,
      customLabel: phone.label,
    }),
  }));
  const readEmails = mapEntriesSorted(card?.emails).map(([id, email]) => ({
    id,
    address: email.address?.trim() || "",
    contextLabels: channelDisplayLabels(email.contexts, labels, {
      customLabel: email.label,
    }),
  }));
  const readAddresses = mapEntriesSorted(card?.addresses).map(([id, address]) => ({
    id,
    lines: addressDisplayFromCard(address),
    contextLabels: channelDisplayLabels(address.contexts, labels, {
      customLabel: typeof address.label === "string" ? address.label : undefined,
    }),
  }));
  const readUrls = mapEntriesSorted(card?.links)
    .filter(([, link]) => link.kind !== "contact")
    .map(([id, link]) => ({
      id,
      uri: link.uri?.trim() ?? "",
      contextLabels: channelDisplayLabels(link.contexts, labels, {
        customLabel: link.label,
      }),
    }));

  return (
    <>
      <DetailSection title={labels.sectionName} hidden={!personName || card?.kind !== "group"}>
        <p className="contacts-detail-view__text">{personName}</p>
      </DetailSection>
      {birthdayDisplay ? (
        <DetailSection title={labels.sectionBirthday}>
          <p className="contacts-detail-view__text">{birthdayDisplay}</p>
        </DetailSection>
      ) : null}
      <DetailSection title={labels.sectionPhones} hidden={readPhones.length === 0}>
        <ul className="contacts-detail-view__channel-list">
          {readPhones.map((row) => {
            const telHref = phoneToTelHref(row.number);
            return (
              <ChannelReadRow
                key={row.id}
                contextLabels={row.contextLabels}
                emptyLabel={labels.channelLabelNone}
              >
                {telHref ? (
                  <a className="contacts-detail-view__link" href={telHref}>
                    {row.number}
                  </a>
                ) : (
                  <span>{row.number}</span>
                )}
              </ChannelReadRow>
            );
          })}
        </ul>
      </DetailSection>
      <DetailSection title={labels.sectionEmails} hidden={readEmails.length === 0}>
        <ul className="contacts-detail-view__channel-list">
          {readEmails.map((row) => (
            <ChannelReadRow
              key={row.id}
              contextLabels={row.contextLabels}
              emptyLabel={labels.channelLabelNone}
            >
              <span>{row.address}</span>
            </ChannelReadRow>
          ))}
        </ul>
      </DetailSection>
      <DetailSection title={labels.sectionAddresses} hidden={readAddresses.length === 0}>
        <ul className="contacts-detail-view__channel-list">
          {readAddresses.map((row) => (
            <ChannelReadRow
              key={row.id}
              contextLabels={row.contextLabels}
              emptyLabel={labels.channelLabelNone}
            >
              <AddressDisplayBlock lines={row.lines} />
            </ChannelReadRow>
          ))}
        </ul>
      </DetailSection>
      <DetailSection title={labels.sectionUrls} hidden={readUrls.length === 0}>
        <ul className="contacts-detail-view__channel-list">
          {readUrls.map((row) => {
            const href = safeContactExternalHref(row.uri);
            return (
              <ChannelReadRow
                key={row.id}
                contextLabels={row.contextLabels}
                emptyLabel={labels.channelLabelNone}
              >
                {href ? (
                  <a
                    className="contacts-detail-view__link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.uri}
                  </a>
                ) : (
                  <span>{row.uri}</span>
                )}
              </ChannelReadRow>
            );
          })}
        </ul>
      </DetailSection>
      <DetailSection title={labels.sectionNotes} hidden={!notesText}>
        <p className="contacts-detail-view__text">{notesText}</p>
      </DetailSection>
    </>
  );
}

export function ContactsDetailView({
  labels,
  card,
  createMode,
  editMode,
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
  groupTags,
  className,
}: ContactsDetailViewProps) {
  const colorOverrides = useAddressBookColorOverrides();
  const isEditing = editMode && !!editDraft;

  return (
    <article className={cn("contacts-detail-view", className)}>
      <header className="contacts-detail-view__header">
        <div className="contacts-detail-view__identity">
          <ContactUserAvatar
            card={card}
            displayName={displayName}
            size="xl"
            compact
            className="contacts-detail-view__avatar"
          />
          {!isEditing && card ? (
            <div className="contacts-detail-view__heading">
              <h1 className="contacts-detail-view__title">{contactDisplayName(card)}</h1>
              {contactViewIdentityLines(card).map((line, index) => (
                <p key={`${index}-${line}`} className="contacts-detail-view__subtitle">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
          {createMode && isEditing ? (
            <h1 className="contacts-detail-view__title">{labels.newContact}</h1>
          ) : null}
        </div>
        {groupTags ? (
          <TagGroup
            className="contacts-detail-view__tag-group"
            size="lg"
            tags={groupTags.assigned.map((chip) =>
              groupToTagItem(chip, !groupTags.readonly && chip.writable, colorOverrides),
            )}
            suggestions={groupTags.suggestions.map((group) => ({
              id: group.id,
              label: contactDisplayName(group),
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
      </header>

      {isEditing && editDraft ? (
        <ContactsDetailEditForm
          labels={labels}
          card={card}
          editDraft={editDraft}
          onDraftChange={onDraftChange}
          onUpdatePhone={onUpdatePhone}
          onUpdateEmail={onUpdateEmail}
          onUpdatePhoneContext={onUpdatePhoneContext}
          onUpdateEmailContext={onUpdateEmailContext}
          onUpdateAddress={onUpdateAddress}
          onUpdateAddressContext={onUpdateAddressContext}
          onUpdateUrl={onUpdateUrl}
          onUpdateUrlContext={onUpdateUrlContext}
          onRemoveUrl={onRemoveUrl}
          onRemovePhone={onRemovePhone}
          onRemoveEmail={onRemoveEmail}
          onRemoveAddress={onRemoveAddress}
        />
      ) : (
        <ContactsDetailReadBody labels={labels} card={card} />
      )}
    </article>
  );
}
