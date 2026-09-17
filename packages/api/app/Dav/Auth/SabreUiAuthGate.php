<?php

declare(strict_types=1);

namespace App\Dav\Auth;

use App\Services\Auth\UserEnabledGuard;

/**
 * Validates the signed {@code sabre_ui_auth} cookie issued after browser sign-in.
 */
final class SabreUiAuthGate
{
    private const COOKIE = 'sabre_ui_auth';

    private const COOKIE_VERSION = 1;

    /**
     * @return non-empty-string|null
     */
    public static function validatedUsername(string $realm): ?string
    {
        $raw = $_COOKIE[self::COOKIE] ?? null;

        return self::validatedUsernameFromRaw(is_string($raw) ? $raw : null, $realm);
    }

    /**
     * @return non-empty-string|null
     */
    public static function validatedUsernameFromRaw(?string $raw, string $realm): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }

        $parts = explode('.', $raw, 2);
        if (count($parts) !== 2) {
            return null;
        }

        [$b64Payload, $b64Sig] = $parts;
        $payloadJson = self::base64UrlDecode($b64Payload);
        if ($payloadJson === null) {
            return null;
        }

        $secret = UiAuthSecret::read();
        if ($secret === null) {
            return null;
        }

        $expected = hash_hmac('sha256', $b64Payload, $secret, true);
        $sig = self::base64UrlDecode($b64Sig);
        if ($sig === null || $sig === '' || ! hash_equals($expected, $sig)) {
            return null;
        }

        try {
            /** @var mixed $payload */
            $payload = json_decode($payloadJson, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        if (! is_array($payload)) {
            return null;
        }
        if (($payload['v'] ?? null) !== self::COOKIE_VERSION) {
            return null;
        }
        if (($payload['r'] ?? '') !== $realm) {
            return null;
        }
        $exp = self::expiryFromPayload($payload);
        if ($exp === null || $exp < time()) {
            return null;
        }
        $username = $payload['u'] ?? '';
        if (! is_string($username) || $username === '') {
            return null;
        }

        $username = strtolower(trim($username));
        // Extra keyed users.enabled lookup per DAV request: HMAC/expiry alone
        // is not enough after disable — do not cache "logged in" across requests.
        if (! app(UserEnabledGuard::class)->isEnabled($username)) {
            return null;
        }

        return $username;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function expiryFromPayload(array $payload): ?int
    {
        foreach (['exp', 'e'] as $key) {
            if (! array_key_exists($key, $payload)) {
                continue;
            }
            $value = $payload[$key];
            if (is_int($value)) {
                return $value;
            }
            if (is_numeric($value)) {
                return (int) $value;
            }
        }

        return null;
    }

    private static function base64UrlDecode(string $data): ?string
    {
        $b64 = strtr($data, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad > 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);

        return $raw === false ? null : $raw;
    }
}
