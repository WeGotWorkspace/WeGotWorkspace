<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Services\Jmap\JmapMethodException;

/**
 * The caller's stored mailbox as JMAP Mailbox objects, for Mailbox/get
 * (vendor `urn:wgw:jmap:mail`). Each call logs in once and lists names only.
 */
final class ImipMailboxFolders
{
    public function __construct(
        private readonly ImipMailboxSettings $settings,
        private readonly ImipMailboxPoller $poller,
        private readonly ImipMailboxLogins $logins,
    ) {}

    /**
     * @return array{state: string, list: array<string, array<string, mixed>>}
     *
     * @throws JmapMethodException serverUnavailable with `retryAfter` when the login budget is
     *                             spent; serverFail with the IMAP `code` when the mailbox cannot be opened
     */
    public function forUser(string $username): array
    {
        $mailbox = $this->settings->find($username);
        if ($mailbox === null) {
            // No mailbox connected: an account without Mailboxes.
            return ['state' => '0', 'list' => []];
        }
        $wait = $this->logins->take($username);
        if ($wait !== null) {
            throw new JmapMethodException('serverUnavailable', 'Too many mailbox logins; try again later.', ['retryAfter' => $wait]);
        }
        try {
            $folders = $this->poller->folders(
                (string) $mailbox->host,
                (int) $mailbox->port,
                (string) $mailbox->security,
                (string) $mailbox->login,
                $this->settings->password($mailbox),
            );
        } catch (ImapException $exception) {
            throw new JmapMethodException('serverFail', 'The mailbox could not be opened.', ['code' => $exception->errorCode]);
        }

        return ['state' => ImipMailboxObjects::state($folders), 'list' => ImipMailboxObjects::fromFolders($folders)];
    }
}
