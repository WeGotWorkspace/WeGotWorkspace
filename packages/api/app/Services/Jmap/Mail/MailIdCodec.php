<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

use App\Services\Mail\MailCredentialService;

/**
 * Mailbox / Email / mb- blob id codec.
 *
 * Email and mb- ids: {mailAccountId}:{base64url(mailbox)}:{uidvalidity}:{uid}
 * Mailbox ids: {mailAccountId}:{base64url(mailbox)} (no UIDVALIDITY).
 */
final class MailIdCodec
{
    public const ACCOUNT_PRIMARY = MailCredentialService::MAIL_ACCOUNT_PRIMARY;

    public static function mailboxId(string $mailAccountId, string $mailbox): string
    {
        return $mailAccountId.':'.self::b64($mailbox);
    }

    public static function emailId(string $mailAccountId, string $mailbox, int $uidvalidity, int $uid): string
    {
        return $mailAccountId.':'.self::b64($mailbox).':'.$uidvalidity.':'.$uid;
    }

    public static function blobId(string $mailAccountId, string $mailbox, int $uidvalidity, int $uid, string $section): string
    {
        return 'mb-'.self::emailId($mailAccountId, $mailbox, $uidvalidity, $uid).':'.$section;
    }

    /**
     * @return array{mailAccountId: string, mailbox: string}|null
     */
    public static function parseMailboxId(string $id): ?array
    {
        $parts = explode(':', $id, 2);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return null;
        }
        $mailbox = self::unb64($parts[1]);
        if ($mailbox === null) {
            return null;
        }

        return ['mailAccountId' => $parts[0], 'mailbox' => $mailbox];
    }

    /**
     * @return array{mailAccountId: string, mailbox: string, uidvalidity: int, uid: int}|null
     */
    public static function parseEmailId(string $id): ?array
    {
        $parts = explode(':', $id);
        if (count($parts) !== 4) {
            return null;
        }
        $mailbox = self::unb64($parts[1]);
        if ($mailbox === null || $parts[0] === '') {
            return null;
        }
        if (! ctype_digit($parts[2]) || ! ctype_digit($parts[3])) {
            return null;
        }

        return [
            'mailAccountId' => $parts[0],
            'mailbox' => $mailbox,
            'uidvalidity' => (int) $parts[2],
            'uid' => (int) $parts[3],
        ];
    }

    /**
     * @return array{mailAccountId: string, mailbox: string, uidvalidity: int, uid: int, section: string}|null
     */
    public static function parseBlobId(string $id): ?array
    {
        if (! str_starts_with($id, 'mb-')) {
            return null;
        }
        $rest = substr($id, 3);
        $parts = explode(':', $rest);
        if (count($parts) < 5) {
            return null;
        }
        $mailbox = self::unb64($parts[1]);
        if ($mailbox === null || $parts[0] === '' || ! ctype_digit($parts[2]) || ! ctype_digit($parts[3])) {
            return null;
        }

        return [
            'mailAccountId' => $parts[0],
            'mailbox' => $mailbox,
            'uidvalidity' => (int) $parts[2],
            'uid' => (int) $parts[3],
            'section' => implode(':', array_slice($parts, 4)),
        ];
    }

    public static function b64(string $mailbox): string
    {
        return rtrim(strtr(base64_encode($mailbox), '+/', '-_'), '=');
    }

    public static function unb64(string $enc): ?string
    {
        $b64 = strtr($enc, '-_', '+/');
        $pad = strlen($b64) % 4;
        if ($pad > 0) {
            $b64 .= str_repeat('=', 4 - $pad);
        }
        $raw = base64_decode($b64, true);

        return is_string($raw) && $raw !== '' ? $raw : null;
    }
}
