import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { contactDisplayName, mapEntriesSorted } from "@/contacts-core/src/contacts-display-utils";

/** Escape special vCard 3.0 characters in property values. */
function vcardEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

/** RFC 6350 line folding — max 75 octets per line, continuation lines start with HTAB. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    chunks.push("\t" + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

type AnniversaryDate = NonNullable<NonNullable<ContactCard["anniversaries"]>[string]>["date"];

function formatBday(date: AnniversaryDate): string {
  if (date["@type"] === "Timestamp") {
    const d = new Date(date.utc);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  const { year, month, day } = date;
  if (year !== undefined && month !== undefined && day !== undefined) {
    return (
      String(year).padStart(4, "0") + String(month).padStart(2, "0") + String(day).padStart(2, "0")
    );
  }
  if (month !== undefined && day !== undefined) {
    return "--" + String(month).padStart(2, "0") + String(day).padStart(2, "0");
  }
  return "";
}

function resolveVCardTypes(
  contexts?: Record<string, boolean | undefined>,
  features?: Record<string, boolean | undefined>,
): string[] {
  const types: string[] = [];
  for (const source of [contexts, features]) {
    if (!source) continue;
    for (const [key, active] of Object.entries(source)) {
      if (active) types.push(key.toUpperCase());
    }
  }
  return types;
}

function typePart(
  contexts?: Record<string, boolean | undefined>,
  features?: Record<string, boolean | undefined>,
): string {
  const types = resolveVCardTypes(contexts, features);
  return types.length > 0 ? `;TYPE=${types.join(",")}` : "";
}

function readLegacyField(address: Record<string, unknown>, field: string): string {
  const value = address[field];
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeVCardUrlValue(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return "";
  return vcardEscape(trimmed);
}

/** Convert a JSContact `ContactCard` to a vCard 3.0 string. */
export function contactCardToVCard(card: ContactCard): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  // FN — required
  lines.push(`FN:${vcardEscape(contactDisplayName(card))}`);

  // N — surname;given;additional;;;
  const components = card.name?.components ?? [];
  const surname = components.find((c) => c.kind === "surname")?.value?.trim() ?? "";
  const given = components.find((c) => c.kind === "given")?.value?.trim() ?? "";
  const additional = components.find((c) => c.kind === "given2")?.value?.trim() ?? "";
  lines.push(`N:${vcardEscape(surname)};${vcardEscape(given)};${vcardEscape(additional)};;`);

  // ORG — name;unit;unit… (department = first org unit)
  for (const [, org] of mapEntriesSorted(card.organizations)) {
    const name = org.name?.trim() ?? "";
    const units = (org.units ?? []).map((unit) => unit.name?.trim() ?? "").filter(Boolean);
    if (!name && units.length === 0) continue;
    lines.push(`ORG:${[name, ...units].map(vcardEscape).join(";")}`);
  }

  // TITLE — JSContact titles (kind title)
  for (const [, title] of mapEntriesSorted(card.titles)) {
    if ((title.kind ?? "title") !== "title") continue;
    const name = title.name?.trim() ?? "";
    if (name) lines.push(`TITLE:${vcardEscape(name)}`);
  }

  // EMAIL
  for (const [, email] of mapEntriesSorted(card.emails)) {
    const address = email.address?.trim() ?? "";
    if (!address) continue;
    lines.push(`EMAIL${typePart(email.contexts)}:${vcardEscape(address)}`);
  }

  // TEL
  for (const [, phone] of mapEntriesSorted(card.phones)) {
    const number = typeof phone.number === "string" ? phone.number.trim() : "";
    if (!number) continue;
    lines.push(`TEL${typePart(phone.contexts, phone.features)}:${vcardEscape(number)}`);
  }

  // ADR — ;;street;locality;region;postal;country
  for (const [, address] of mapEntriesSorted(card.addresses)) {
    const addrRecord = address as Record<string, unknown>;
    const comps = address.components ?? [];
    const nameComp = comps
      .filter((c) => c.kind === "name")
      .map((c) => c.value)
      .join(" ")
      .trim();
    const numberComp = comps
      .filter((c) => c.kind === "number")
      .map((c) => c.value)
      .join(" ")
      .trim();
    const street =
      [numberComp, nameComp].filter(Boolean).join(" ").trim() ||
      readLegacyField(addrRecord, "street") ||
      (typeof address.full === "string" ? address.full.trim() : "");
    const locality =
      comps.find((c) => c.kind === "locality")?.value?.trim() ||
      readLegacyField(addrRecord, "locality");
    const region =
      comps.find((c) => c.kind === "region")?.value?.trim() ||
      readLegacyField(addrRecord, "region");
    const postalCode =
      comps.find((c) => c.kind === "postcode")?.value?.trim() ||
      readLegacyField(addrRecord, "postcode");
    const country =
      comps.find((c) => c.kind === "country")?.value?.trim() ||
      readLegacyField(addrRecord, "country");

    lines.push(
      `ADR${typePart(address.contexts)}:;;${vcardEscape(street)};${vcardEscape(locality)};${vcardEscape(region)};${vcardEscape(postalCode)};${vcardEscape(country)}`,
    );
  }

  // URL — skip contact-kind links
  for (const [, link] of mapEntriesSorted(card.links)) {
    if (link.kind === "contact") continue;
    const uri = sanitizeVCardUrlValue(link.uri ?? "");
    if (uri) lines.push(`URL:${uri}`);
  }

  // NOTE
  for (const [, note] of mapEntriesSorted(card.notes)) {
    const text = note.note?.trim() ?? "";
    if (text) lines.push(`NOTE:${vcardEscape(text)}`);
  }

  // BDAY
  const birthEntry = mapEntriesSorted(card.anniversaries).find(
    ([, ann]) => ann.kind === "birth",
  )?.[1];
  if (birthEntry) {
    const bday = formatBday(birthEntry.date);
    if (bday) lines.push(`BDAY:${bday}`);
  }

  // UID
  if (card.uid) lines.push(`UID:${vcardEscape(card.uid)}`);

  lines.push("END:VCARD");

  return lines.map(foldLine).join("\r\n");
}

/** Derive a safe `.vcf` filename from a contact's display name. */
export function vcardFilename(displayName: string): string {
  const safe =
    displayName
      .trim()
      .replace(/[^\w\s\-_.]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_") || "contact";
  return `${safe}.vcf`;
}

/** Build a vCard blob and trigger a browser download for the given contact card. */
export function downloadContactVCard(card: ContactCard): void {
  const vcardText = contactCardToVCard(card);
  const blob = new Blob([vcardText], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = vcardFilename(contactDisplayName(card));
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Concatenate multiple contact cards into a single `.vcf` blob (RFC 6350 multi-vCard)
 * and trigger a browser download.
 */
export function downloadMultipleContactsVCard(cards: ContactCard[]): void {
  if (cards.length === 0) return;
  if (cards.length === 1) {
    downloadContactVCard(cards[0]);
    return;
  }
  const vcardText = cards.map(contactCardToVCard).join("\r\n");
  const blob = new Blob([vcardText], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${cards.length}-contacts.vcf`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
