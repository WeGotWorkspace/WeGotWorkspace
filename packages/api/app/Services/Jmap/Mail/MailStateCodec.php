<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

/**
 * Per-mail-account state string: versioned digest of
 * {mailbox → (uidvalidity, uidnext, window-flags-hash)}.
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
            $payload[] = $mailbox."\t".$row['uidvalidity']."\t".$row['uidnext']."\t".$row['window'];
        }

        return self::PREFIX.substr(hash('sha256', implode("\n", $payload)), 0, 32);
    }

    public static function isValid(string $state): bool
    {
        return str_starts_with($state, self::PREFIX) && strlen($state) === strlen(self::PREFIX) + 32;
    }
}
