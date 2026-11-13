<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Models\CalendarReplyMailbox;
use App\Support\DataDirSecretBox;

/**
 * Reads and writes a user's reply mailbox row. The password is encrypted
 * at rest under its own key label and only ever decrypted here, for a login.
 */
class ImipMailboxSettings
{
    public const SECRET_LABEL = 'calendar-replies|imap';

    public function __construct(private readonly DataDirSecretBox $secrets) {}

    public function find(string $username): ?CalendarReplyMailbox
    {
        return CalendarReplyMailbox::query()->find($username);
    }

    public function password(CalendarReplyMailbox $mailbox): string
    {
        return $this->secrets->decrypt((string) $mailbox->password_enc, self::SECRET_LABEL);
    }

    /**
     * Store the connection fields. A null password keeps the stored one. A
     * new host, login or folder starts reading from the moment of the
     * connection test (cursor from `$test`, trusted server reset); an
     * existing cursor is kept, so a re-test never skips unread mail.
     *
     * @param  array{host: string, port: int, security: string, login: string, folder: string}  $fields
     * @param  array{trustedServerId: string, uidValidity: int, highestUid: int}  $test
     */
    public function save(string $username, array $fields, ?string $password, array $test): CalendarReplyMailbox
    {
        $mailbox = $this->find($username) ?? new CalendarReplyMailbox(['username' => $username]);
        $moved = ! $mailbox->exists
            || strcasecmp((string) $mailbox->host, $fields['host']) !== 0
            || (string) $mailbox->login !== $fields['login']
            || (string) $mailbox->folder !== $fields['folder'];
        $mailbox->fill($fields);
        if ($password !== null) {
            $mailbox->password_enc = $this->secrets->encrypt($password, self::SECRET_LABEL);
        }
        if ($moved || $mailbox->uidvalidity === null || $mailbox->last_uid === null) {
            $mailbox->uidvalidity = $test['uidValidity'];
            $mailbox->last_uid = $test['highestUid'];
        }
        $trustedServerId = $test['trustedServerId'];
        if ($trustedServerId !== '') {
            $mailbox->trusted_server_id = $trustedServerId;
        } elseif ($moved) {
            $mailbox->trusted_server_id = '';
        }
        $mailbox->enabled = true;
        $mailbox->auth_failures = 0;
        $mailbox->last_error_code = null;
        $mailbox->last_error_at = null;
        $mailbox->last_polled_at = null;
        $mailbox->updated_at = time();
        $mailbox->save();

        return $mailbox;
    }

    public function delete(string $username): void
    {
        CalendarReplyMailbox::query()->where('username', $username)->delete();
    }
}
