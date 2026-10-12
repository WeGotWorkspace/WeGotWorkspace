<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Models\AppSetting;
use Illuminate\Support\Facades\Crypt;

/**
 * The ECDSA P-256 pair that signs collaboration tickets (contract C2).
 *
 * The pair is generated on first use and kept in `app_settings`: the private
 * PEM encrypted with the application key, the key id in the clear. Only the
 * public half ever leaves the server, as a JWK carrying its `kid` so clients
 * can cache it. Rotation publishes a new `kid`; tickets signed by the previous
 * one are not revoked — they expire on their own fifteen minutes later.
 */
final class CollabTicketKeyring
{
    public const PRIVATE_PEM_SETTING = 'collab_ticket_private_pem';

    public const KID_SETTING = 'collab_ticket_kid';

    private const COORDINATE_BYTES = 32;

    /**
     * Read through to the stored pair on every call. Laravel memoises the
     * resolved controller on the route, so an instance outlives a request and a
     * cached pair here would keep signing with a key that rotation retired.
     *
     * @return array{kid: string, pem: string}
     */
    public function current(): array
    {
        return $this->read() ?? $this->generate();
    }

    /**
     * Public half in JWK form, ready for `crypto.subtle.importKey('jwk', …)`.
     *
     * @return array{kty: string, crv: string, x: string, y: string, kid: string, alg: string, use: string}
     */
    public function publicJwk(): array
    {
        $pair = $this->current();
        $key = openssl_pkey_get_private($pair['pem']);
        if ($key === false) {
            throw new \RuntimeException('The stored collaboration ticket key is unreadable.');
        }

        $details = openssl_pkey_get_details($key);
        $curve = is_array($details) ? ($details['ec'] ?? null) : null;
        if (! is_array($curve) || ! is_string($curve['x'] ?? null) || ! is_string($curve['y'] ?? null)) {
            throw new \RuntimeException('The stored collaboration ticket key is not an EC key.');
        }

        return [
            'kty' => 'EC',
            'crv' => 'P-256',
            'x' => CollabTicketCodec::base64UrlEncode($this->coordinate($curve['x'])),
            'y' => CollabTicketCodec::base64UrlEncode($this->coordinate($curve['y'])),
            'kid' => $pair['kid'],
            'alg' => 'ES256',
            'use' => 'sig',
        ];
    }

    /**
     * @return array{kid: string, pem: string}
     */
    public function rotate(): array
    {
        AppSetting::query()
            ->whereIn('name', [self::PRIVATE_PEM_SETTING, self::KID_SETTING])
            ->delete();

        return $this->current();
    }

    /**
     * @return array{kid: string, pem: string}|null
     */
    private function read(): ?array
    {
        $kid = trim((string) AppSetting::getValue(self::KID_SETTING, ''));
        $sealed = trim((string) AppSetting::getValue(self::PRIVATE_PEM_SETTING, ''));
        if ($kid === '' || $sealed === '') {
            return null;
        }

        try {
            $pem = Crypt::decryptString($sealed);
        } catch (\Throwable) {
            return null;
        }

        return openssl_pkey_get_private($pem) === false ? null : ['kid' => $kid, 'pem' => $pem];
    }

    /**
     * First use on a fresh install. Two concurrent joins can both get here, so
     * the row is only claimed when it is still empty and the loser adopts the
     * pair the winner published rather than signing with an orphan key.
     *
     * @return array{kid: string, pem: string}
     */
    private function generate(): array
    {
        $resource = openssl_pkey_new([
            'curve_name' => 'prime256v1',
            'private_key_type' => OPENSSL_KEYTYPE_EC,
        ]);
        if ($resource === false || ! openssl_pkey_export($resource, $pem)) {
            throw new \RuntimeException('Could not generate a collaboration ticket key.');
        }

        AppSetting::query()->insertOrIgnore([
            ['name' => self::KID_SETTING, 'value' => bin2hex(random_bytes(8))],
            ['name' => self::PRIVATE_PEM_SETTING, 'value' => Crypt::encryptString($pem)],
        ]);

        $published = $this->read();
        if ($published === null) {
            throw new \RuntimeException('Could not store the collaboration ticket key.');
        }

        return $published;
    }

    /** OpenSSL hands back the shortest big-endian form; a JWK coordinate is fixed width. */
    private function coordinate(string $raw): string
    {
        return str_pad($raw, self::COORDINATE_BYTES, "\x00", STR_PAD_LEFT);
    }
}
