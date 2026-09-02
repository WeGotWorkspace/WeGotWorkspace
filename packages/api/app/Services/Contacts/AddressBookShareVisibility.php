<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\AddressBookShareDismissal;

/**
 * Per-user hide of an inbound address-book share. Does not change the owner's shareWith grant.
 */
final class AddressBookShareVisibility
{
    /**
     * @return list<int>
     */
    public function dismissedAddressBookIds(string $username): array
    {
        return AddressBookShareDismissal::query()
            ->where('username', $username)
            ->pluck('addressbookid')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
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
