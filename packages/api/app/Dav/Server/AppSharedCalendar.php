<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\BackendInterface;
use Sabre\CalDAV\SharedCalendar;
use Sabre\DAV\Exception\Forbidden;

/**
 * {@see SharedCalendar} without Sabre's read-free-busy grant to every signed-in user.
 *
 * Owners, sharees and delegates keep free/busy through {DAV:}read, which aggregates
 * it. Team colleagues get availability only through the scheduling outbox, which
 * applies the Team availability rules (#1907).
 *
 * A feed subscription is read-only for everyone (#2370): its ACL grants no
 * write, bind, unbind, property, or share privilege, so PUT, DELETE, PROPPATCH
 * and MKCOL inside it are refused, and it cannot be deleted from a calendar app.
 */
class AppSharedCalendar extends SharedCalendar
{
    private const READ_FREE_BUSY = '{urn:ietf:params:xml:ns:caldav}read-free-busy';

    private const READ_PRIVILEGES = ['{DAV:}read', self::READ_FREE_BUSY];

    private ?bool $subscription = null;

    public static function fromStock(SharedCalendar $calendar, BackendInterface $backend): self
    {
        return new self($backend, $calendar->calendarInfo);
    }

    /** The `calendars.id` of this collection (the same for the owner and every sharee). */
    public function collectionId(): int
    {
        return $this->calendarId();
    }

    /** The calendar's id, shared by every instance of it. */
    public function calendarId(): int
    {
        $id = $this->calendarInfo['id'] ?? null;

        return is_array($id) ? (int) ($id[0] ?? 0) : (int) $id;
    }

    /**
     * @return array<int, array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL()
    {
        return $this->withoutSubscriptionWrites($this->withoutFreeBusyForEveryone(parent::getACL()));
    }

    /**
     * @return array<int, array{privilege: string, principal: string, protected?: bool}>
     */
    public function getChildACL()
    {
        return $this->withoutSubscriptionWrites(parent::getChildACL());
    }

    public function delete(): void
    {
        if ($this->isSubscription()) {
            throw new Forbidden('A subscribed calendar cannot be removed from a calendar app. Unsubscribe in the web app.');
        }
        parent::delete();
    }

    private function isSubscription(): bool
    {
        return $this->subscription ??= app(SubscriptionCalendars::class)->isSubscription($this->calendarId());
    }

    /**
     * @param  array<int, array{privilege: string, principal: string, protected?: bool}>  $acl
     * @return array<int, array{privilege: string, principal: string, protected?: bool}>
     */
    private function withoutFreeBusyForEveryone(array $acl): array
    {
        return array_values(array_filter(
            $acl,
            static fn (array $ace): bool => ! ($ace['privilege'] === self::READ_FREE_BUSY
                && $ace['principal'] === '{DAV:}authenticated'),
        ));
    }

    /**
     * @param  array<int, array{privilege: string, principal: string, protected?: bool}>  $acl
     * @return array<int, array{privilege: string, principal: string, protected?: bool}>
     */
    private function withoutSubscriptionWrites(array $acl): array
    {
        if (! $this->isSubscription()) {
            return $acl;
        }

        return array_values(array_filter(
            $acl,
            static fn (array $ace): bool => in_array($ace['privilege'], self::READ_PRIVILEGES, true),
        ));
    }
}
