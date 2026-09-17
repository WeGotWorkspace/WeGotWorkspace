import { createMailAppBootstrap, type MailAppBootstrap } from "@/lib/api/mock/mail-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createJmapMailOperations, fetchMailLiveBootstrap } from "@/lib/api/wgw/mail-jmap";
import { WGW_UI_SYSTEM_MAILBOXES } from "@/lib/api/wgw/mail";
import type { MailMailboxLoader, MailAPIOperations } from "@/mail-core/src/mail-types";

export type MailApiSource = {
  loadBootstrap: () => Promise<MailAppBootstrap>;
  systemMailboxes: readonly string[];
  createOperations: (mailboxLoader?: MailMailboxLoader) => MailAPIOperations | undefined;
};

function createWgwOperations(mailboxLoader?: MailMailboxLoader): MailAPIOperations {
  return createJmapMailOperations(mailboxLoader);
}

export function createDefaultMailApiSource(): MailApiSource {
  return createWorkspaceSource<MailApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createMailAppBootstrap()),
      systemMailboxes: [...WGW_UI_SYSTEM_MAILBOXES] as const,
      createOperations: () => undefined,
    }),
    createLiveSource: () => ({
      loadBootstrap: fetchMailLiveBootstrap,
      systemMailboxes: [...WGW_UI_SYSTEM_MAILBOXES] as const,
      createOperations: (mailboxLoader) => createWgwOperations(mailboxLoader),
    }),
  });
}
