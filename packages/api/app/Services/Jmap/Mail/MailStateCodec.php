<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

/**
 * Per-mail-account state string: versioned round-trip of
 * {mailbox → (uidvalidity, uidnext, window-flags-hash)}.
 *
 * Wire form is `m1:` + base64url(JSON). Legacy `m1:` + 32-hex digests are
 * still isValid (mailbox/changes can treat them as "something changed") but
 * parse() returns null so Email/changes answers cannotCalculateChanges.
 */
final class MailStateCodec
{
    public const PREFIX = 'm1:';

    /**
     * @param  array<string, array{uidvalidity: int, uidnext: int, window: string}>  $mailboxes
     */
    public static function compose(array $mailboxes): string
    {
        ksort($mailboxes);
        $payload = [];
        foreach ($mailboxes as $mailbox => $row) {
            $payload[$mailbox] = [
                'uv' => (int) $row['uidvalidity'],
                'un' => (int) $row['uidnext'],
                'w' => (string) $row['window'],
            ];
        }

        return self::PREFIX.self::base64UrlEncode(
            json_encode($payload, JSON_FORCE_OBJECT | JSON_THROW_ON_ERROR),
        );
    }

    /**
     * @return array<string, array{uidvalidity: int, uidnext: int, window: string}>|null
     */
    public static function parse(string $state): ?array
    {
        if (! str_starts_with($state, self::PREFIX)) {
            return null;
        }
        $rest = substr($state, strlen(self::PREFIX));
        if ($rest === '' || (strlen($rest) === 32 && ctype_xdigit($rest))) {
            return null;
        }
        $json = self::base64UrlDecode($rest);
        if ($json === null) {
            return null;
        }
        try {
            $data = json_decode($json, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        if (! is_array($data)) {
            return null;
        }
        $out = [];
        foreach ($data as $mailbox => $row) {
            if (! is_string($mailbox) || ! is_array($row)) {
                return null;
            }
            $out[$mailbox] = [
                'uidvalidity' => (int) ($row['uv'] ?? 0),
                'uidnext' => (int) ($row['un'] ?? 0),
                'window' => (string) ($row['w'] ?? ''),
            ];
        }

        return $out;
    }

    public static function isValid(string $state): bool
    {
        if (! str_starts_with($state, self::PREFIX)) {
            return false;
        }
        $rest = substr($state, strlen(self::PREFIX));
        if (strlen($rest) === 32 && ctype_xdigit($rest)) {
            return true;
        }

        return self::parse($state) !== null;
    }

    private static function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $encoded): ?string
    {
        $b64 = strtr($encoded, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad !== 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);

        return $raw === false ? null : $raw;
    }
}
