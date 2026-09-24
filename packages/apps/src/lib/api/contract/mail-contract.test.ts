import { describe, expect, it, expectTypeOf } from "vitest";
import type { MailMessageListItem } from "@wgw/openapi-types/mail-types";
import {
  coerceMailListRow,
  mailFromWgwListItem,
  parseMessagesPayload,
} from "@/lib/api/wgw/mail-message-utils";
import type { WgwMailMessageListItem } from "@/lib/api/wgw/types";
import type { Mail } from "@/types/mail";
import { assertFieldMappings } from "@/lib/api/contract/contract-assert";

const inboxFolderToken = "aW5ib3g";

/** OpenAPI-shaped list row before app coercion (uid supplied via wire alias). */
const mailListRowFixture = {
  id: `${inboxFolderToken}:901`,
  folderId: inboxFolderToken,
  from: { name: "Bob Sender", email: "bob@example.test" },
  subject: "Quarterly update",
  preview: "Please review the attached summary before Friday.",
  date: "2026-06-01T09:15:00Z",
  read: false,
  starred: true,
} satisfies MailMessageListItem;

const mailMessagesPayloadFixture = {
  messages: [mailListRowFixture],
  hasMore: false,
};

describe("mail UI ↔ OpenAPI contract", () => {
  describe("type-level parity", () => {
    it("preserves folder on WgwMailMessageListItem after OpenAPI narrowing", () => {
      expectTypeOf<WgwMailMessageListItem["folder"]>().toEqualTypeOf<string>();
    });

    it("requires numeric uid on coerced list rows used by the mapper", () => {
      expectTypeOf<WgwMailMessageListItem["uid"]>().toEqualTypeOf<number>();
    });

    it("maps list-row identity fields into Mail", () => {
      type MailIdentityFromApi = Pick<Mail, "folder" | "uid" | "title" | "date">;
      expectTypeOf<MailIdentityFromApi["folder"]>().toEqualTypeOf<
        WgwMailMessageListItem["folder"]
      >();
      expectTypeOf<MailIdentityFromApi["uid"]>().toEqualTypeOf<WgwMailMessageListItem["uid"]>();
      expectTypeOf<MailIdentityFromApi["title"]>().toEqualTypeOf<
        NonNullable<WgwMailMessageListItem["subject"]>
      >();
    });

    /** Document UI-only enrichments not present on MailMessageListItem. */
    it("allows UI-only Mail fields beyond the OpenAPI list row", () => {
      type MailUiOnly = Omit<
        Mail,
        "folder" | "uid" | "title" | "date" | "starred" | "unread" | "id"
      >;
      expectTypeOf<MailUiOnly>().toBeObject();
      expectTypeOf<MailUiOnly["excerpt"]>().toEqualTypeOf<string>();
      expectTypeOf<MailUiOnly["wordCount"]>().toEqualTypeOf<number>();
    });
  });

  describe("adapter round-trip", () => {
    it("coerces OpenAPI list rows and maps required identity fields into Mail", () => {
      const coerced = coerceMailListRow(
        mailListRowFixture as WgwMailMessageListItem,
        inboxFolderToken,
      );
      const mail = mailFromWgwListItem(coerced, { [inboxFolderToken]: "Inbox" });

      assertFieldMappings([
        { path: "folder", api: inboxFolderToken, ui: mail.folder },
        { path: "uid", api: 901, ui: mail.uid },
        { path: "subject→title", api: mailListRowFixture.subject, ui: mail.title },
        { path: "date", api: mailListRowFixture.date, ui: mail.date },
      ]);

      expect(mail.starred).toBe(true);
      expect(mail.unread).toBe(true);
    });

    it("parses GET /mail/messages payloads and maps each row", () => {
      const rows = parseMessagesPayload(mailMessagesPayloadFixture, inboxFolderToken);
      expect(rows).toHaveLength(1);

      const mail = mailFromWgwListItem(rows[0]!, { [inboxFolderToken]: "Inbox" });
      expect(mail.uid).toBe(901);
      expect(mail.title).toBe("Quarterly update");
    });

    it("derives unread from OpenAPI read flag (inverted for UI)", () => {
      const unreadRow = coerceMailListRow(
        { ...mailListRowFixture, read: false } as WgwMailMessageListItem,
        inboxFolderToken,
      );
      const readRow = coerceMailListRow(
        { ...mailListRowFixture, read: true } as WgwMailMessageListItem,
        inboxFolderToken,
      );

      const unreadMail = mailFromWgwListItem(unreadRow, { [inboxFolderToken]: "Inbox" });
      const readMail = mailFromWgwListItem(readRow, { [inboxFolderToken]: "Inbox" });

      expect(unreadMail.unread).toBe(true);
      expect(readMail.unread).toBe(false);
    });

    it("maps OpenAPI starred to Mail.starred via flagged coercion", () => {
      const starredRow = coerceMailListRow(
        { ...mailListRowFixture, starred: true, read: true } as WgwMailMessageListItem,
        inboxFolderToken,
      );
      const mail = mailFromWgwListItem(starredRow, { [inboxFolderToken]: "Inbox" });
      expect(mail.starred).toBe(true);
    });
  });
});
