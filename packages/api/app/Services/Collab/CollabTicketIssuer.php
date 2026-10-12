<?php

declare(strict_types=1);

namespace App\Services\Collab;

/**
 * Mints contract C2 tickets. Everything in the payload is server-resolved:
 * the room key, the authenticated username, the peer id the server handed out
 * and the access right {@see CollabJoinAuthorizer} computed from the share
 * grant. A client never gets to claim any of it.
 */
final class CollabTicketIssuer
{
    public function __construct(private CollabTicketKeyring $keyring) {}

    public function issue(
        string $roomKey,
        string $username,
        string $peerId,
        string $access,
        ?int $now = null,
    ): string {
        $pair = $this->keyring->current();
        $payload = CollabTicketCodec::payload(
            $pair['kid'],
            $roomKey,
            $username,
            $peerId,
            $access,
            $now ?? time(),
        );

        $key = openssl_pkey_get_private($pair['pem']);
        if ($key === false) {
            throw new \RuntimeException('The collaboration ticket key is unreadable.');
        }

        $signingInput = CollabTicketCodec::signingInput($payload);
        if (! openssl_sign($signingInput, $der, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Could not sign the collaboration ticket.');
        }

        return $signingInput.'.'.CollabTicketCodec::base64UrlEncode(
            CollabTicketCodec::derToP1363($der),
        );
    }

    /**
     * @return array{kty: string, crv: string, x: string, y: string, kid: string, alg: string, use: string}
     */
    public function publicJwk(): array
    {
        return $this->keyring->publicJwk();
    }

    /** True while a poll must answer in full so the peer picks up a fresh ticket. */
    public function inHandoverWindow(?int $now = null): bool
    {
        return CollabTicketCodec::inHandoverWindow($now ?? time());
    }
}
