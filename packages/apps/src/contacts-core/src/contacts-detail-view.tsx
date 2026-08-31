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

function groupToTagItem(chip: ContactDetailGroupChip, removable: boolean): TagItem {
  const { group } = chip;
  return {
    id: group.id,
    label: contactDisplayName(group),
    icon: <ContactsGroupIcon book={group} />,
    collectionTint: groupAddressBookColor(group),
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
  const isEditing = editMode && !!editDraft;

  const readPhones = isEditing
    ? (editDraft?.phones ?? [])
    : mapEntriesSorted(card?.phones).map(([id, phone]) => ({
        id,
        number: contactPhoneDisplayValue(phone),
        contextLabels: channelDisplayLabels(phone.contexts, labels, {
          features: phone.features,
          customLabel: phone.label,
        }),
      }));

  const readEmails = isEditing
    ? (editDraft?.emails ?? [])
    : mapEntriesSorted(card?.emails).map(([id, email]) => ({
        id,
        address: email.address?.trim() || "",
        contextLabels: channelDisplayLabels(email.contexts, labels, {
          customLabel: email.label,
        }),
      }));

  const readAddresses = isEditing
    ? (editDraft?.addresses ?? [])
    : mapEntriesSorted(card?.addresses).map(([id, address]) => ({
        id,
        lines: addressDisplayFromCard(address),
        contextLabels: channelDisplayLabels(address.contexts, labels, {
          customLabel: typeof address.label === "string" ? address.label : undefined,
        }),
      }));

  const readUrls = isEditing
    ? (editDraft?.urls ?? [])
    : mapEntriesSorted(card?.links)
        .filter(([, link]) => link.kind !== "contact")
        .map(([id, link]) => ({
          id,
          uri: link.uri?.trim() ?? "",
          contextLabels: channelDisplayLabels(link.contexts, labels, {
            customLabel: link.label,
          }),
        }));

  const personName = isEditing
    ? ""
    : (() => {
        if (!card) return "";
        return contactPersonName(card);
      })();

  const organization = isEditing
    ? (editDraft?.organization ?? "")
    : (() => {
        const name = mapEntriesSorted(card?.organizations)[0]?.[1]?.name;
        return typeof name === "string" ? name.trim() : "";
      })();

  const jobTitle = isEditing
    ? (editDraft?.title ?? "")
    : (() => {
        const entry =
          mapEntriesSorted(card?.titles).find(([, title]) => (title.kind ?? "title") === "title") ??
          mapEntriesSorted(card?.titles)[0];
        return entry?.[1]?.name?.trim() ?? "";
      })();

  const jobDepartment = isEditing
    ? (editDraft?.department ?? "")
    : (() => {
        const unit = mapEntriesSorted(card?.organizations)[0]?.[1]?.units?.[0]?.name;
        return typeof unit === "string" ? unit.trim() : "";
      })();

  /** Identity lines beside the header name (view mode only). Groups are name-only. */
  const viewIdentityLines = (() => {
    if (isEditing || !card || card.kind === "group") return [] as string[];
    const lines: string[] = [];
    if (card.kind === "org") {
      const subtitle = contactListSubtitle(card);
      if (subtitle) lines.push(subtitle);
      if (jobTitle) lines.push(jobTitle);
      if (jobDepartment) lines.push(jobDepartment);
      return lines;
    }
    if (jobTitle) lines.push(jobTitle);
    const orgLine = [jobDepartment, organization].filter(Boolean).join(" · ");
    if (orgLine) lines.push(orgLine);
    return lines;
  })();

  const notes = isEditing
    ? (editDraft?.notes ?? "")
    : (() => {
        const note = mapEntriesSorted(card?.notes)[0]?.[1]?.note;
        return typeof note === "string" ? note.trim() : "";
      })();

  const showAsCompany = !!editDraft?.showAsCompany;

  const nameFields =
    isEditing && editDraft ? (
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
    ) : null;

  const organizationField =
    isEditing && editDraft ? (
      <FieldLabelRow label={labels.organizationName} htmlFor="contact-organization">
        <Input
          id="contact-organization"
          value={editDraft.organization}
          onChange={(event) => onDraftChange({ organization: event.target.value })}
        />
      </FieldLabelRow>
    ) : null;

  const jobFields =
    isEditing && editDraft ? (
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
    ) : null;

  const companyToggle =
    isEditing && editDraft ? (
      <FieldLabelRow label={labels.companyContact}>
        <Switch
          checked={editDraft.showAsCompany}
          onCheckedChange={(checked) => onDraftChange({ showAsCompany: checked })}
          aria-label={labels.companyContact}
        />
      </FieldLabelRow>
    ) : null;

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
              {viewIdentityLines.map((line, index) => (
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
              groupToTagItem(chip, !groupTags.readonly && chip.writable),
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

      <DetailSection
        title={labels.sectionName}
        hidden={!isEditing && (!personName || card?.kind !== "group")}
      >
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__field-stack">
            {showAsCompany ? (
              <>
                {organizationField}
                {nameFields}
                {jobFields}
                {companyToggle}
              </>
            ) : (
              <>
                {nameFields}
                {jobFields}
                {organizationField}
                {companyToggle}
              </>
            )}
          </div>
        ) : (
          <p className="contacts-detail-view__text">{personName}</p>
        )}
      </DetailSection>

      {!isEditing && card
        ? (() => {
            const birthday = contactBirthdayDisplay(card);
            return birthday ? (
              <DetailSection title={labels.sectionBirthday}>
                <p className="contacts-detail-view__text">{birthday}</p>
              </DetailSection>
            ) : null;
          })()
        : null}

      <DetailSection title={labels.sectionPhones} hidden={!isEditing && readPhones.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            <ContactPhoneRows
              phones={editDraft.phones}
              labels={labels}
              onUpdatePhone={onUpdatePhone}
              onUpdatePhoneContext={onUpdatePhoneContext}
              onRemovePhone={onRemovePhone}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readPhones.map((row) => {
              const number = "number" in row ? row.number : "";
              const telHref = phoneToTelHref(number);
              return (
                <ChannelReadRow
                  key={row.id}
                  contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                  emptyLabel={labels.channelLabelNone}
                >
                  {telHref ? (
                    <a className="contacts-detail-view__link" href={telHref}>
                      {number}
                    </a>
                  ) : (
                    <span>{number}</span>
                  )}
                </ChannelReadRow>
              );
            })}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={labels.sectionEmails} hidden={!isEditing && readEmails.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            <ContactEmailRows
              emails={editDraft.emails}
              labels={labels}
              onUpdateEmail={onUpdateEmail}
              onUpdateEmailContext={onUpdateEmailContext}
              onRemoveEmail={onRemoveEmail}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readEmails.map((row) => (
              <ChannelReadRow
                key={row.id}
                contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                emptyLabel={labels.channelLabelNone}
              >
                <span>{"address" in row ? row.address : ""}</span>
              </ChannelReadRow>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection
        title={labels.sectionAddresses}
        hidden={!isEditing && readAddresses.length === 0}
      >
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list contacts-detail-view__address-list">
            <ContactAddressRows
              addresses={editDraft.addresses}
              labels={labels}
              onUpdateAddress={onUpdateAddress}
              onUpdateAddressContext={onUpdateAddressContext}
              onRemoveAddress={onRemoveAddress}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readAddresses.map((row) => (
              <ChannelReadRow
                key={row.id}
                contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
                emptyLabel={labels.channelLabelNone}
              >
                {"lines" in row ? <AddressDisplayBlock lines={row.lines} /> : null}
              </ChannelReadRow>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title={labels.sectionUrls} hidden={!isEditing && readUrls.length === 0}>
        {isEditing && editDraft ? (
          <div className="contacts-detail-view__editable-list">
            <ContactUrlRows
              urls={editDraft.urls}
              labels={labels}
              onUpdateUrl={onUpdateUrl}
              onUpdateUrlContext={onUpdateUrlContext}
              onRemoveUrl={onRemoveUrl}
            />
          </div>
        ) : (
          <ul className="contacts-detail-view__channel-list">
            {readUrls.map((row) => {
              const href = safeContactExternalHref(row.uri);
              return (
                <ChannelReadRow
                  key={row.id}
                  contextLabels={"contextLabels" in row ? row.contextLabels : undefined}
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
        )}
      </DetailSection>

      <DetailSection title={labels.sectionNotes} hidden={!isEditing && !notes}>
        {isEditing && editDraft ? (
          <Textarea
            id="contact-notes"
            className="contacts-detail-view__notes"
            aria-label={labels.sectionNotes}
            value={editDraft.notes}
            onChange={(event) => onDraftChange({ notes: event.target.value })}
          />
        ) : (
          <p className="contacts-detail-view__text">{notes}</p>
        )}
      </DetailSection>
    </article>
  );
}
