<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\Imip\ImipMailboxFolders;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * Mailbox/get (RFC 8621 §2.1) under vendor urn:wgw:jmap:mail: the folders of
 * the caller's connected IMAP mailbox, read-only. Each call logs in to the
 * mail server once (counted with saving and testing the mailbox), so there is
 * no Mailbox/changes yet: clients compare `state`. Without a connected
 * mailbox the account simply has no Mailboxes.
 */
final class MailboxGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly ImipMailboxFolders $folders) {}

    public function name(): string
    {
        return 'Mailbox/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::MAIL;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $ids = $this->requestedIds($args);
        $mailboxes = $this->folders->forUser($username);
        $notFound = [];
        if ($ids === null) {
            $list = array_values($mailboxes['list']);
            $this->guardGetAllBound($list);
        } else {
            $list = [];
            foreach ($ids as $id) {
                if (isset($mailboxes['list'][$id])) {
                    $list[] = $mailboxes['list'][$id];
                } else {
                    $notFound[] = $id;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $mailboxes['state'],
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
