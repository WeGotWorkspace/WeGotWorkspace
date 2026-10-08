import type { HelloFrame, LinkRejectReason } from "@/lib/rtc/link/link-channel-protocol";
import type { RoomEndpointState } from "@/lib/rtc/link/link-channel-types";
import {
  tighterDocsCollabAccess,
  type DocsCollabAccess,
} from "@/text-editor-core/docs-collab/docs-collab-access";
import { verifyCollabTicket } from "@/text-editor-core/docs-collab/docs-collab-ticket";

export type HelloVerdict =
  | { ok: true; peer: string; access: DocsCollabAccess; ticketAccess: DocsCollabAccess }
  | { ok: false; reason: LinkRejectReason }
  | { ok: "need-roster" };

/**
 * The receiving browser decides. The linked user comes from the server-derived
 * principal roster. The hello's peer must be on this room's collab roster under
 * that same user. With a published key the ticket must verify for that user and
 * peer, and access is the tighter of ticket and roster.
 */
export async function verifyCollabHello(input: {
  hello: HelloFrame;
  linkUser: string;
  room: RoomEndpointState;
  resolveKey: (kid: string) => Promise<CryptoKey | null>;
  nowSeconds?: number;
}): Promise<HelloVerdict> {
  const { hello, linkUser, room } = input;
  const row = room.roster.find((candidate) => candidate.id === hello.peer);
  if (!row) return { ok: "need-roster" };
  if (row.user !== linkUser) return { ok: false, reason: "user-mismatch" };
  if (!room.jwk) {
    return { ok: true, peer: hello.peer, access: row.access, ticketAccess: "write" };
  }
  if (!hello.ticket) return { ok: false, reason: "ticket-rejected" };
  const payload = await verifyCollabTicket({
    ticket: hello.ticket,
    claims: { room: room.roomKey, user: linkUser, peer: hello.peer },
    resolveKey: input.resolveKey,
    nowSeconds: input.nowSeconds,
  });
  if (!payload || payload.user !== linkUser || payload.peer !== hello.peer) {
    return { ok: false, reason: "ticket-rejected" };
  }
  return {
    ok: true,
    peer: hello.peer,
    access: tighterDocsCollabAccess(payload.access, row.access),
    ticketAccess: payload.access,
  };
}
