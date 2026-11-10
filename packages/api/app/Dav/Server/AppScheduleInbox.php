<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\SchedulingSupport;
use Sabre\CalDAV\Schedule\Inbox;

/**
 * {@see Inbox} readable only by its owner and the owner's delegates.
 *
 * Sabre grants {DAV:}read on every inbox to every signed-in user, which let them
 * list and query another user's pending invitations. Delivery checks
 * schedule-deliver, which stays open to signed-in users.
 */
final class AppScheduleInbox extends Inbox
{
    public static function fromStock(Inbox $inbox): self
    {
        $backend = $inbox->caldavBackend;
        if (! $backend instanceof SchedulingSupport) {
            throw new \LogicException('A schedule inbox needs a backend with scheduling support.');
        }

        return new self($backend, $inbox->principalUri);
    }

    /**
     * @return list<array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL()
    {
        $acl = array_values(array_filter(
            parent::getACL(),
            static fn (array $ace): bool => ! ($ace['privilege'] === '{DAV:}read'
                && $ace['principal'] === '{DAV:}authenticated'),
        ));
        foreach (['', '/calendar-proxy-read', '/calendar-proxy-write'] as $suffix) {
            $acl[] = [
                'privilege' => '{DAV:}read',
                'principal' => $this->getOwner().$suffix,
                'protected' => true,
            ];
        }

        return $acl;
    }
}
