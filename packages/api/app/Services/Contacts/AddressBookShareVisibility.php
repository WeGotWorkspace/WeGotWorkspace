<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\AddressBookShare;
use App\Models\AddressBookShareDismissal;
use App\Services\Calendars\CalendarShareVisibility;
use App\Services\Teams\TeamColleagues;
use Illuminate\Database\Eloquent\Collection;

/**
 * Which inbound address-book shares a user sees, like
 * {@see CalendarShareVisibility}: per-user dismissal (does not change
 * the owner's shareWith grant), and hiding of a grant whose owner no longer shares a Team with
 * the sharee (Epic #1915), computed on read so nothing is deleted.
 */
final class AddressBookShareVisibility
{
    public function __construct(private readonly TeamColleagues $colleagues) {}

    /**
     * Drops grants whose owner is a user who shares no Team with the grantee (or left the Team
     * the book went to). Team-owned books stay. The answer does not depend on `$viewer`.
     *
     * @param  Collection<int, AddressBookShare>  $grants  with `addressbook` loaded
     * @return Collection<int, AddressBookShare>
     */
    public function rejectHiddenSharees(string $viewer, Collection $grants): Collection
    {
        return $grants
            ->filter(fn (AddressBookShare $grant): bool => $this->colleagues->grantIsVisible(
                $grant->addressbook?->principaluri,
                (string) $grant->principaluri,
            ))
            ->values();
    }

    /**
     * @param  list<AddressBookListing>  $listings
     * @return list<AddressBookListing>
     */
    public function rejectDismissedSharees(string $viewer, array $listings): array
    {
        $dismissed = array_flip($this->dismissedAddressBookIds($viewer));
        if ($dismissed === []) {
            return $listings;
        }

        return array_values(array_filter(
            $listings,
            static fn (AddressBookListing $listing): bool => ! $listing->isSharee
                || ! array_key_exists((int) $listing->book->id, $dismissed),
        ));
    }

    /**
     * @return list<int>
     */
    public function dismissedAddressBookIds(string $username): array
    {
        return array_values(AddressBookShareDismissal::query()
            ->where('username', $username)
            ->pluck('addressbookid')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all());
    }

    public function isDismissed(string $username, int $addressBookId): bool
    {
        return in_array($addressBookId, $this->dismissedAddressBookIds($username), true);
    }

    public function dismiss(string $username, int $addressBookId): void
    {
        AddressBookShareDismissal::query()->updateOrCreate(
            ['username' => $username, 'addressbookid' => $addressBookId],
            ['dismissed_at' => now()],
        );
    }

    public function restore(string $username, int $addressBookId): void
    {
        AddressBookShareDismissal::query()
            ->where('username', $username)
            ->where('addressbookid', $addressBookId)
            ->delete();
    }
}
