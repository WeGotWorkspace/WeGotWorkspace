<?php

declare(strict_types=1);

namespace App\Services\Meet;

use Illuminate\Http\Request;

final class MeetActorResolver
{
    public function __construct(private MeetRequestAuth $auth) {}

    public function tryAuthenticatedUsername(Request $request): ?string
    {
        $realm = (string) config('wgw.auth_realm', 'SabreDAV');

        return $this->auth->tryAuthenticatedUsername($request, $realm);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    public function requireActorMarker(Request $request, array $body): string
    {
        $marker = $this->ownerMarkerForAuthenticatedUser($this->tryAuthenticatedUsername($request));
        if ($marker !== null) {
            return $marker;
        }

        $sessionKey = $this->readGuestSessionKey($body);
        if ($sessionKey !== null) {
            return $this->ownerMarkerForGuestSession($sessionKey);
        }

        throw new MeetResponseException(401, [
            'error' => 'auth_required',
            'message' => 'Sign in or re-open the guest join link to start a signaling session.',
        ]);
    }

    /**
     * @return non-empty-string|null
     */
    public function ownerMarkerForAuthenticatedUser(?string $username): ?string
    {
        if ($username === null || $username === '') {
            return null;
        }

        return 'u:'.$username;
    }

    /**
     * Server-issued guest key: 16 random bytes, then the first 32 hex
     * characters of HMAC-SHA256(APP_KEY, those bytes). A caller-chosen key
     * does not verify, so it is not an actor.
     *
     * @return non-empty-string
     */
    public function newGuestSessionKey(): string
    {
        $random = random_bytes(16);

        return bin2hex($random).$this->guestSessionMac($random);
    }

    /**
     * @return non-empty-string
     */
    public function ownerMarkerForGuestSession(string $sessionKey): string
    {
        return 'g:'.$sessionKey;
    }

    /**
     * @param  array<string, mixed>  $body
     * @return non-empty-string|null
     */
    public function readGuestSessionKey(array $body): ?string
    {
        $raw = $body['sessionKey'] ?? null;
        if (! is_string($raw) || preg_match('/^[a-f0-9]{64}$/', $raw) !== 1) {
            return null;
        }

        $random = hex2bin(substr($raw, 0, 32));
        if (! is_string($random) || strlen($random) !== 16) {
            return null;
        }

        $given = substr($raw, 32);
        if (! hash_equals($this->guestSessionMac($random), $given)) {
            return null;
        }

        return $raw;
    }

    private function guestSessionMac(string $random): string
    {
        return substr(hash_hmac('sha256', $random, $this->appKey()), 0, 32);
    }

    /** Laravel's `base64:` prefix is the encoding, not part of the HMAC key. */
    private function appKey(): string
    {
        $key = (string) config('app.key', '');
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if (is_string($decoded) && $decoded !== '') {
                return $decoded;
            }
        }

        return $key;
    }
}
