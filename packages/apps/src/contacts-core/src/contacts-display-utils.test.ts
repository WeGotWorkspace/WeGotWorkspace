import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { defaultContactsLabels } from "./contacts-labels";
import {
  channelDisplayLabels,
  contactBirthdayDisplay,
  contactDisplayName,
  isContactOrgCard,
  contactInitials,
  contactListDetail,
  contactListSortName,
  contactListSubtitle,
  contactPhotoUrl,
  contactPhotoBlobId,
  CONTACT_MEDIA_BLOB_PATH,
  filterCardsBySearch,
  groupContactCardsBySection,
  mapEntriesSorted,
  phoneToTelHref,
  safeContactExternalHref,
  sortContactCardsForList,
} from "./contacts-display-utils";

const janeCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane",
  uid: "urn:uuid:jane-example",
  addressBookIds: { default: true as const },
  name: { "@type": "Name" as const, isOrdered: false, full: "Jane Doe" },
  organizations: {
    "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
  },
  emails: {
    "email-1": { "@type": "EmailAddress" as const, address: "jane@example.com" },
  },
  phones: {
    "phone-1": { "@type": "Phone" as const, number: "+1-555-0101" },
  },
} as unknown as ContactCard;

const joeCard = {
  "@type": "Card",
  version: "1.0",
  id: "card-joe",
  uid: "urn:uuid:joe-example",
  addressBookIds: { work: true as const },
  name: {
    "@type": "Name" as const,
    isOrdered: false,
    components: [
      { "@type": "NameComponent" as const, kind: "given" as const, value: "Joe" },
      { "@type": "NameComponent" as const, kind: "surname" as const, value: "Example" },
    ],
  },
  emails: {
    "email-2": { "@type": "EmailAddress" as const, address: "joe@example.com" },
  },
} as unknown as ContactCard;

describe("contacts-display-utils", () => {
  it("derives display name from full or name components", () => {
    expect(contactDisplayName(janeCard)).toBe("Jane Doe");
    expect(contactDisplayName(joeCard)).toBe("Joe Example");
  });

  it("shows one secondary line: company over email over phone", () => {
    expect(contactListSubtitle(janeCard)).toBe("Acme Corp");
    expect(contactListDetail(janeCard)).toBe("");

    const noOrg: ContactCard = { ...joeCard, organizations: undefined };
    expect(contactListSubtitle(noOrg)).toBe("");
    expect(contactListDetail(noOrg)).toBe("joe@example.com");

    const orgOnly: ContactCard = { ...janeCard, emails: undefined, phones: undefined };
    expect(contactListSubtitle(orgOnly)).toBe("Acme Corp");
    expect(contactListDetail(orgOnly)).toBe("");

    const phoneOnly: ContactCard = {
      ...joeCard,
      emails: undefined,
      phones: {
        "phone-1": { "@type": "Phone" as const, number: "+1-555-0100" },
      },
    };
    expect(contactListSubtitle(phoneOnly)).toBe("");
    expect(contactListDetail(phoneOnly)).toBe("+1-555-0100");

    const neither: ContactCard = { ...joeCard, emails: undefined, phones: undefined };
    expect(contactListSubtitle(neither)).toBe("");
    expect(contactListDetail(neither)).toBe("");
  });

  it("shows only person name in subtitle for org cards; email as list detail", () => {
    const companyCard = {
      "@type": "Card",
      version: "1.0",
      id: "card-acme",
      uid: "urn:uuid:acme-example",
      kind: "org" as const,
      addressBookIds: { default: true as const },
      organizations: {
        "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
      },
      emails: {
        "email-1": { "@type": "EmailAddress" as const, address: "info@acme.com" },
      },
      phones: {
        "phone-1": { "@type": "Phone" as const, number: "+1-555-0199" },
      },
    } as unknown as ContactCard;

    expect(isContactOrgCard(companyCard)).toBe(true);
    expect(isContactOrgCard(janeCard)).toBe(false);
    expect(contactDisplayName(companyCard)).toBe("Acme Corp");
    expect(contactListSubtitle(companyCard)).toBe("");
    expect(contactListDetail(companyCard)).toBe("info@acme.com");
  });

  it("shows person name in subtitle for org card that has a person name", () => {
    const companyWithPerson = { ...janeCard, kind: "org" as const } as unknown as ContactCard;

    expect(contactDisplayName(companyWithPerson)).toBe("Acme Corp");
    expect(contactListSubtitle(companyWithPerson)).toBe("Jane Doe");
    expect(contactListDetail(companyWithPerson)).toBe("");
  });

  it("shows group name first for group cards; org name in subtitle if present", () => {
    const groupNoOrg = {
      "@type": "Card",
      version: "1.0",
      id: "card-group-friends",
      uid: "urn:uuid:group-friends",
      kind: "group" as const,
      addressBookIds: { default: true as const },
      name: { "@type": "Name" as const, isOrdered: false, full: "Friends" },
      members: {},
    } as unknown as ContactCard;

    expect(contactDisplayName(groupNoOrg)).toBe("Friends");
    expect(contactListSubtitle(groupNoOrg)).toBe("");

    const groupWithOrg = {
      ...groupNoOrg,
      organizations: {
        "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
      },
      emails: {
        "email-1": { "@type": "EmailAddress" as const, address: "friends@example.com" },
      },
    } as unknown as ContactCard;

    expect(contactDisplayName(groupWithOrg)).toBe("Friends");
    expect(contactListSubtitle(groupWithOrg)).toBe("Acme Corp");
    expect(contactListDetail(groupWithOrg)).toBe("");
  });

  describe("contactListDetail primary channel", () => {
    it("prefers the email with the lowest pref", () => {
      const card: ContactCard = {
        ...joeCard,
        emails: {
          "email-work": {
            "@type": "EmailAddress" as const,
            address: "work@example.com",
            pref: 2,
          },
          "email-home": {
            "@type": "EmailAddress" as const,
            address: "home@example.com",
            pref: 1,
          },
        },
        phones: {
          "phone-1": { "@type": "Phone" as const, number: "+1-555-0100", pref: 1 },
        },
      };
      expect(contactListDetail(card)).toBe("home@example.com");
    });

    it("falls back to primary phone when no email is present", () => {
      const card: ContactCard = {
        ...joeCard,
        emails: undefined,
        phones: {
          "phone-work": { "@type": "Phone" as const, number: "+1-555-0100", pref: 2 },
          "phone-mobile": { "@type": "Phone" as const, number: "+1-555-0199", pref: 1 },
        },
      };
      expect(contactListDetail(card)).toBe("+1-555-0199");
    });

    it("returns empty when neither email nor phone exists", () => {
      const card: ContactCard = { ...joeCard, emails: undefined, phones: undefined };
      expect(contactListDetail(card)).toBe("");
    });

    it("skips group cards unless they have a channel", () => {
      const group: ContactCard = {
        "@type": "Card",
        version: "1.0",
        id: "card-group-empty",
        uid: "urn:uuid:group-empty",
        kind: "group",
        addressBookIds: { default: true as const },
        name: { "@type": "Name" as const, isOrdered: false, full: "Friends" },
        members: {},
      } as unknown as ContactCard;
      expect(contactListDetail(group)).toBe("");

      const groupWithEmail: ContactCard = {
        ...group,
        emails: {
          "email-1": { "@type": "EmailAddress" as const, address: "friends@example.com" },
        },
      };
      expect(contactListDetail(groupWithEmail)).toBe("friends@example.com");
    });

    it("uses first sorted email when no pref is set", () => {
      const card: ContactCard = {
        ...joeCard,
        emails: {
          "email-z": { "@type": "EmailAddress" as const, address: "z@example.com" },
          "email-a": { "@type": "EmailAddress" as const, address: "a@example.com" },
        },
        phones: {
          "phone-1": { "@type": "Phone" as const, number: "+1-555-0100" },
        },
      };
      expect(contactListDetail(card)).toBe("a@example.com");
    });

    it("formats phone from number, then uri", () => {
      const numberCard: ContactCard = {
        ...joeCard,
        emails: undefined,
        phones: {
          "phone-1": { "@type": "Phone" as const, number: "  +1-555-0101  " },
        },
      };
      expect(contactListDetail(numberCard)).toBe("+1-555-0101");

      const uriCard = {
        ...joeCard,
        emails: undefined,
        phones: {
          "phone-1": { "@type": "Phone" as const, number: "   ", uri: "tel:+15550100" },
        },
      } as unknown as ContactCard;
      expect(contactListDetail(uriCard)).toBe("tel:+15550100");
    });
  });

  it("computes initials from a display name", () => {
    expect(contactInitials("Jane Doe")).toBe("JD");
    expect(contactInitials("Cher")).toBe("CH");
    expect(contactInitials("")).toBe("?");
  });

  it("resolves photo URL from JSContact media map", () => {
    const withPhotoUri: ContactCard = {
      ...janeCard,
      media: {
        "media-1": {
          "@type": "Media" as const,
          kind: "photo" as const,
          uri: "https://example.com/photos/jane.jpg",
        },
      },
    };
    expect(contactPhotoUrl(withPhotoUri)).toBe("https://example.com/photos/jane.jpg");

    const withBlob = {
      ...janeCard,
      media: {
        "media-1": {
          "@type": "Media" as const,
          kind: "photo" as const,
          blobId: "550e8400-e29b-41d4-a716-446655440099",
        },
      },
    } as unknown as ContactCard;
    expect(contactPhotoUrl(withBlob)).toBe(
      `${CONTACT_MEDIA_BLOB_PATH}/550e8400-e29b-41d4-a716-446655440099`,
    );

    const withDataUri: ContactCard = {
      ...janeCard,
      media: {
        "media-1": {
          "@type": "Media" as const,
          kind: "photo" as const,
          uri: "data:image/png;base64,abc",
        },
      },
    };
    expect(contactPhotoUrl(withDataUri)).toBe("data:image/png;base64,abc");

    expect(contactPhotoUrl(janeCard)).toBeUndefined();
  });

  it("resolves Apple-synced vCard 3.0 binary JPEG photo via blobId URL", () => {
    // Apple CardDAV pushes PHOTO;ENCODING=b;TYPE=JPEG — the server converts the
    // embedded bytes to a blob and returns blobId. The frontend must build a
    // display URL from that blobId so the avatar shows up in the contact list.
    const applePhotoCard = {
      ...janeCard,
      media: {
        "media-apple": {
          "@type": "Media" as const,
          kind: "photo" as const,
          blobId: "aabbccdd-1122-4aab-8aab-aabbccdd0001",
          mediaType: "image/jpeg",
        },
      },
    } as unknown as ContactCard;
    expect(contactPhotoUrl(applePhotoCard)).toBe(
      `${CONTACT_MEDIA_BLOB_PATH}/aabbccdd-1122-4aab-8aab-aabbccdd0001`,
    );
    expect(contactPhotoBlobId(applePhotoCard)).toBe("aabbccdd-1122-4aab-8aab-aabbccdd0001");
  });

  it("prefers logo over photo for organization cards", () => {
    const orgCard = {
      ...janeCard,
      kind: "org" as const,
      media: {
        "media-logo": {
          "@type": "Media" as const,
          kind: "logo" as const,
          uri: "https://example.com/logo.png",
        },
        "media-photo": {
          "@type": "Media" as const,
          kind: "photo" as const,
          uri: "https://example.com/photo.jpg",
        },
      },
    } as unknown as ContactCard;

    expect(contactPhotoUrl(orgCard)).toBe("https://example.com/logo.png");
  });

  it("prefers photo over logo for person cards", () => {
    const personCard = {
      ...janeCard,
      media: {
        "media-logo": {
          "@type": "Media" as const,
          kind: "logo" as const,
          uri: "https://example.com/logo.png",
        },
        "media-photo": {
          "@type": "Media" as const,
          kind: "photo" as const,
          uri: "https://example.com/photo.jpg",
        },
      },
    } as unknown as ContactCard;

    expect(contactPhotoUrl(personCard)).toBe("https://example.com/photo.jpg");
  });

  it("sorts map entries by stable key order", () => {
    expect(mapEntriesSorted({ z: 1, a: 2, m: 3 })).toEqual([
      ["a", 2],
      ["m", 3],
      ["z", 1],
    ]);
  });

  it("filters cards by display name, email, and phone", () => {
    const cards = [janeCard, joeCard];
    expect(filterCardsBySearch(cards, "acme").map((card) => card.id)).toEqual(["card-jane"]);
    expect(filterCardsBySearch(cards, "555").map((card) => card.id)).toEqual(["card-jane"]);
    expect(filterCardsBySearch(cards, "joe@").map((card) => card.id)).toEqual(["card-joe"]);
    expect(filterCardsBySearch(cards, "")).toEqual(cards);
  });

  it("resolves channel display labels from contexts and custom labels", () => {
    const labels = defaultContactsLabels;
    expect(channelDisplayLabels({ private: true }, labels)).toEqual(["Home"]);
    expect(channelDisplayLabels({ home: true }, labels)).toEqual(["Home"]);
    expect(channelDisplayLabels({ work: true }, labels)).toEqual(["Work"]);
    expect(channelDisplayLabels({ school: true }, labels)).toEqual(["School"]);
    expect(channelDisplayLabels(undefined, labels, { customLabel: "  Assistant  " })).toEqual([
      "Assistant",
    ]);
    expect(channelDisplayLabels({ voice: true }, labels)).toEqual([]);
    expect(channelDisplayLabels(undefined, labels)).toEqual([]);
  });

  it("returns multiple phone feature and context tags in stable order", () => {
    const labels = defaultContactsLabels;
    expect(
      channelDisplayLabels({ private: true }, labels, {
        features: { voice: true },
      }),
    ).toEqual(["voice", "Home"]);
    expect(
      channelDisplayLabels(undefined, labels, {
        features: { mobile: true, voice: true },
      }),
    ).toEqual(["Mobile", "voice"]);
    expect(
      channelDisplayLabels(undefined, labels, {
        features: { mobile: true },
      }),
    ).toEqual(["Mobile"]);
    expect(
      channelDisplayLabels({ work: true }, labels, {
        features: { fax: true, voice: true },
      }),
    ).toEqual(["fax", "voice", "Work"]);
  });

  it("builds tel: href from phone number string", () => {
    expect(phoneToTelHref("+1-555-0101")).toBe("tel:+1-555-0101");
    expect(phoneToTelHref("+31 20 123 4567")).toBe("tel:+31201234567");
    expect(phoneToTelHref("  ")).toBe("");
    expect(phoneToTelHref("")).toBe("");
    expect(phoneToTelHref("(555) 867-5309")).toBe("tel:(555)867-5309");
  });

  it("allows only safe external contact link protocols", () => {
    expect(safeContactExternalHref("https://example.com/profile")).toBe(
      "https://example.com/profile",
    );
    expect(safeContactExternalHref("mailto:jane@example.com")).toBe("mailto:jane@example.com");
    expect(safeContactExternalHref("javascript:alert(1)")).toBe("");
    expect(safeContactExternalHref("/relative/path")).toBe("");
    expect(safeContactExternalHref("")).toBe("");
  });

  it("splits comma-separated custom labels into separate tags", () => {
    const labels = defaultContactsLabels;
    expect(channelDisplayLabels(undefined, labels, { customLabel: "voice,home" })).toEqual([
      "voice",
      "Home",
    ]);
    expect(channelDisplayLabels(undefined, labels, { customLabel: "voice, home" })).toEqual([
      "voice",
      "Home",
    ]);
    expect(
      channelDisplayLabels(undefined, labels, {
        features: { voice: true },
        customLabel: "voice,home",
      }),
    ).toEqual(["voice", "Home"]);
    expect(channelDisplayLabels(undefined, labels, { customLabel: "cell,voice" })).toEqual([
      "Mobile",
      "voice",
    ]);
    expect(
      channelDisplayLabels(undefined, labels, {
        features: { mobile: true, voice: true },
        customLabel: "cell,voice",
      }),
    ).toEqual(["Mobile", "voice"]);
  });

  describe("contactBirthdayDisplay", () => {
    it("returns empty string when no anniversaries", () => {
      expect(contactBirthdayDisplay(janeCard)).toBe("");
    });

    it("returns empty string when a cleared birth slot is null", () => {
      const card = {
        ...janeCard,
        anniversaries: { "bday-1": null },
      } as unknown as ContactCard;
      expect(() => contactBirthdayDisplay(card)).not.toThrow();
      expect(contactBirthdayDisplay(card)).toBe("");
    });

    it("returns empty string when no birth kind anniversary", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "wedding" as const,
            date: { "@type": "PartialDate" as const, year: 2010, month: 6, day: 15 },
          },
        },
      };
      expect(contactBirthdayDisplay(card)).toBe("");
    });

    it("formats PartialDate with year, month, and day", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, year: 1990, month: 6, day: 13 },
          },
        },
      };
      const result = contactBirthdayDisplay(card, "en-US");
      expect(result).toBe("June 13, 1990");
    });

    it("formats PartialDate with only month and day (no year)", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, month: 3, day: 7 },
          },
        },
      };
      const result = contactBirthdayDisplay(card, "en-US");
      expect(result).toBe("March 7");
    });

    it("formats PartialDate with only year", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, year: 1985 },
          },
        },
      };
      expect(contactBirthdayDisplay(card, "en-US")).toBe("1985");
    });

    it("formats Timestamp date", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "Timestamp" as const, utc: "1990-06-13T00:00:00Z" },
          },
        },
      };
      const result = contactBirthdayDisplay(card, "en-US");
      expect(result).toMatch(/June/);
      expect(result).toMatch(/1990/);
    });

    it("displays Apple-synced BDAY with year (YYYY-MM-DD parsed server-side to PartialDate)", () => {
      // Apple Contacts stores BDAY:1985-03-15 (hyphenated). The server converts this to a
      // PartialDate with year/month/day and the frontend must display it — verifies the full fix.
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, year: 1985, month: 3, day: 15 },
          },
        },
      };
      expect(contactBirthdayDisplay(card, "en-US")).toBe("March 15, 1985");
    });

    it("displays Apple-synced BDAY without year (--MM-DD parsed server-side to no-year PartialDate)", () => {
      // Apple Contacts stores BDAY:--03-15 for birthdays without year.
      // The server converts this to a PartialDate with month/day but no year.
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-1": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, month: 3, day: 15 },
          },
        },
      };
      expect(contactBirthdayDisplay(card, "en-US")).toBe("March 15");
    });

    it("picks first birth entry when multiple anniversaries exist", () => {
      const card: ContactCard = {
        ...janeCard,
        anniversaries: {
          "ann-wedding": {
            "@type": "Anniversary" as const,
            kind: "wedding" as const,
            date: { "@type": "PartialDate" as const, year: 2010, month: 6, day: 15 },
          },
          "ann-birth": {
            "@type": "Anniversary" as const,
            kind: "birth" as const,
            date: { "@type": "PartialDate" as const, year: 1990, month: 3, day: 7 },
          },
        },
      };
      const result = contactBirthdayDisplay(card, "en-US");
      expect(result).toBe("March 7, 1990");
    });
  });

  it("sorts contacts by surname then given name", () => {
    const aliceSmith = {
      ...janeCard,
      id: "card-alice",
      name: { "@type": "Name" as const, isOrdered: false, full: "Alice Smith" },
    } as unknown as ContactCard;
    const bobAdams = {
      ...joeCard,
      id: "card-bob",
      name: {
        "@type": "Name" as const,
        isOrdered: false,
        components: [
          { "@type": "NameComponent" as const, kind: "given" as const, value: "Bob" },
          { "@type": "NameComponent" as const, kind: "surname" as const, value: "Adams" },
        ],
      },
    } as unknown as ContactCard;

    expect(contactListSortName(aliceSmith)).toBe("Smith, Alice");
    expect(contactListSortName(bobAdams)).toBe("Adams, Bob");
    expect(sortContactCardsForList([aliceSmith, bobAdams]).map((card) => card.id)).toEqual([
      "card-bob",
      "card-alice",
    ]);
  });

  it("sorts surname-only and single-name contacts by available name parts", () => {
    const surnameOnly = {
      ...janeCard,
      id: "card-vendrik",
      name: {
        "@type": "Name" as const,
        isOrdered: false,
        components: [
          { "@type": "NameComponent" as const, kind: "surname" as const, value: "Vendrik" },
        ],
      },
    } as unknown as ContactCard;
    const mononym = {
      ...joeCard,
      id: "card-cher",
      name: { "@type": "Name" as const, isOrdered: false, full: "Cher" },
    } as unknown as ContactCard;

    expect(contactListSortName(surnameOnly)).toBe("Vendrik");
    expect(contactListSortName(mononym)).toBe("Cher");
    expect(sortContactCardsForList([mononym, surnameOnly]).map((card) => card.id)).toEqual([
      "card-cher",
      "card-vendrik",
    ]);
  });

  it("sorts org cards by organization name", () => {
    const companyCard = {
      ...janeCard,
      id: "card-acme",
      kind: "org" as const,
      name: undefined,
      organizations: {
        "org-1": { "@type": "Organization" as const, name: "Acme Corp" },
      },
    } as unknown as ContactCard;

    expect(contactListSortName(companyCard)).toBe("Acme Corp");
  });

  it("sorts contacts alphabetically by surname-first sort key", () => {
    const cards = [joeCard, janeCard];
    expect(sortContactCardsForList(cards).map((card) => card.id)).toEqual([
      "card-jane",
      "card-joe",
    ]);
  });

  it("groups sorted contacts into sticky section letters by surname", () => {
    const sections = groupContactCardsBySection([joeCard, janeCard]);
    expect(sections).toEqual([
      { letter: "D", cards: [janeCard] },
      { letter: "E", cards: [joeCard] },
    ]);
  });

  it("uses # when the sort key does not start with A–Z", () => {
    const numericMononym = {
      ...janeCard,
      id: "card-123",
      name: { "@type": "Name" as const, isOrdered: false, full: "123" },
    } as unknown as ContactCard;

    expect(groupContactCardsBySection([numericMononym])).toEqual([
      { letter: "#", cards: [numericMononym] },
    ]);
  });

  it("sections multi-token names by surname even when given starts with a digit", () => {
    const addressLikeName = {
      ...janeCard,
      id: "card-123-main",
      name: { "@type": "Name" as const, isOrdered: false, full: "123 Main" },
    } as unknown as ContactCard;

    expect(contactListSortName(addressLikeName)).toBe("Main, 123");
    expect(groupContactCardsBySection([addressLikeName])).toEqual([
      { letter: "M", cards: [addressLikeName] },
    ]);
  });
});
