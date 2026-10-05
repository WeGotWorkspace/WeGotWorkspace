<?php

declare(strict_types=1);

namespace App\Services\Rtc;

/**
 * TURN REST credentials, coturn `use-auth-secret` semantics: the username is
 * `<unixExpiry>:<actor marker>` and the password is the base64 of its
 * HMAC-SHA1 under the shared secret, so coturn can verify without a user
 * database and the credential dies with the timestamp.
 *
 * The actor marker is hashed before it goes on the wire — a relay operator
 * learns that someone connected, not who.
 */
final class RtcTurnCredentialService
{
    public const TTL_SECONDS = 3600;

    public function __construct(private RtcSettingsService $settings) {}

    public function available(): bool
    {
        return $this->settings->turnAvailable();
    }

    /**
     * @return array{urls: list<string>, username: string, credential: string, ttl: int}|null
     *                                                                                        Null when no relay is configured.
     */
    public function mint(string $actorMarker, ?int $now = null): ?array
    {
        $secret = $this->settings->turnSecret();
        $urls = $this->settings->turnUrls();
        if ($secret === '' || $urls === []) {
            return null;
        }

        $username = self::username($actorMarker, ($now ?? time()) + self::TTL_SECONDS);

        return [
            'urls' => $urls,
            'username' => $username,
            'credential' => self::credential($username, $secret),
            'ttl' => self::TTL_SECONDS,
        ];
    }

    public static function username(string $actorMarker, int $expiresAt): string
    {
        return $expiresAt.':'.substr(sha1($actorMarker), 0, 16);
    }

    public static function credential(string $username, string $secret): string
    {
        return base64_encode(hash_hmac('sha1', $username, $secret, true));
    }
}
