<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Models\Addressbook;
use App\Models\AddressBookShare;
use App\Models\Principal;
use App\Services\Calendars\CalendarPrincipalAddresses;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Persists RFC 9610/9670 AddressBook shareWith. CardDAV has no calendarinstances
 * analog — grants live in addressbook_shares (JMAP/browser only).
 */
final class AddressBookShareInvites
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
    ) {}

    public function canShare(AddressBookListing $listing): bool
    {
        return $listing->canShare();
    }

    /**
     * @return array<string, array{mayRead: bool, mayWrite: bool, mayShare: bool, mayDelete: bool}>|null
     */
    public function shareWithForOwner(Addressbook $book): ?array
    {
        $grants = [];
        foreach ($this->grantsForBook((int) $book->id) as $share) {
            $id = $this->addresses->jmapIdForPrincipalUri((string) $share->principaluri);
            if ($id === null) {
                continue;
            }
            $grants[$id] = $this->restRightsForAccess((int) $share->access);
        }

        return $grants === [] ? null : $grants;
    }

    public function apply(Addressbook $book, mixed $shareWith): void
    {
        $bookId = (int) $book->id;
        if ($shareWith === null) {
            $deleted = AddressBookShare::query()->where('addressbookid', $bookId)->delete();
            if ($deleted > 0) {
                $this->bumpSyncToken($book);
            }

            return;
        }

        if (! is_array($shareWith)) {
            throw new ApiHttpException(400, 'shareWith must be an object or null.', 'invalidProperties', ['shareWith']);
        }

        $changed = false;
        $invalid = [];
        foreach ($shareWith as $id => $grant) {
            if (! is_string($id) || $id === '') {
                $invalid[] = 'shareWith';

                continue;
            }
            $principal = $this->addresses->principalForJmapId($id);
            if ($principal === null) {
                $invalid[] = 'shareWith/'.$id;

                continue;
            }
            if ((string) $principal->uri === (string) $book->principaluri) {
                continue;
            }
            if ($grant === null) {
                $deleted = AddressBookShare::query()
                    ->where('addressbookid', $bookId)
                    ->where('principaluri', (string) $principal->uri)
                    ->delete();
                $changed = $changed || $deleted > 0;

                continue;
            }
            if (! is_array($grant)) {
                $invalid[] = 'shareWith/'.$id;

                continue;
            }

            $unsupported = $this->unsupportedGrantRights($id, $grant);
            if ($unsupported !== []) {
                throw new ApiHttpException(
                    400,
                    'Address book share grants only persist mayRead and mayWrite.',
                    'invalidProperties',
                    $unsupported,
                );
            }

            AddressBookShare::query()->updateOrCreate(
                [
                    'addressbookid' => $bookId,
                    'principaluri' => (string) $principal->uri,
                ],
                [
                    'href' => $this->hrefForPrincipal($principal, $bookId),
                    'access' => $this->accessFromRights($grant),
                    'displayname' => is_string($principal->displayname) ? $principal->displayname : $id,
                ],
            );
            $changed = true;
        }

        if ($invalid !== []) {
            throw new ApiHttpException(400, 'Unknown or invalid share principal.', 'invalidProperties', $invalid);
        }

        if ($changed) {
            $this->bumpSyncToken($book);
        }
    }

    /**
     * Drop grants from a group's book and grants targeting groups/{slug}.
     *
     * @param  list<int>  $addressBookIds
     */
    public function deleteGrantsForGroupPrincipal(string $principalUri, array $addressBookIds): void
    {
        AddressBookShare::query()
            ->where(function ($query) use ($principalUri, $addressBookIds): void {
                $query->where('principaluri', $principalUri);
                if ($addressBookIds !== []) {
                    $query->orWhereIn('addressbookid', $addressBookIds);
                }
            })
            ->delete();
    }

    /**
     * @return list<AddressBookShare>
     */
    public function grantsForBook(int $addressBookId): array
    {
        return AddressBookShare::query()
            ->where('addressbookid', $addressBookId)
            ->orderBy('id')
            ->get()
            ->all();
    }

    /**
     * Highest access per address book for the given principal URIs (user + groups).
     *
     * @param  list<string>  $principalUris
     * @return array<int, int> addressbookid → access
     */
    public function highestAccessByBook(array $principalUris): array
    {
        if ($principalUris === []) {
            return [];
        }

        $best = [];
        foreach (AddressBookShare::query()->whereIn('principaluri', $principalUris)->get() as $share) {
            $bookId = (int) $share->addressbookid;
            $access = (int) $share->access;
            if (! isset($best[$bookId]) || $access > $best[$bookId]) {
                $best[$bookId] = $access;
            }
        }

        return $best;
    }

    /**
     * @param  array<string, mixed>  $grant
     * @return list<string>
     */
    private function unsupportedGrantRights(string $principalId, array $grant): array
    {
        $invalid = [];
        foreach (['mayShare', 'mayDelete'] as $flag) {
            if (($grant[$flag] ?? false) === true) {
                $invalid[] = 'shareWith/'.$principalId.'/'.$flag;
            }
        }

        return $invalid;
    }

    /**
     * @param  array<string, mixed>  $rights
     */
    private function accessFromRights(array $rights): int
    {
        $mayWrite = ($rights['mayWrite'] ?? false) === true
            || ($rights['mayWriteAll'] ?? false) === true;

        return $mayWrite ? SharingPlugin::ACCESS_READWRITE : SharingPlugin::ACCESS_READ;
    }

    /**
     * @return array{mayRead: bool, mayWrite: bool, mayShare: bool, mayDelete: bool}
     */
    private function restRightsForAccess(int $access): array
    {
        return [
            'mayRead' => true,
            'mayWrite' => $access === SharingPlugin::ACCESS_READWRITE,
            'mayShare' => false,
            'mayDelete' => false,
        ];
    }

    private function hrefForPrincipal(Principal $principal, int $bookId): string
    {
        $existing = AddressBookShare::query()
            ->where('addressbookid', $bookId)
            ->where('principaluri', (string) $principal->uri)
            ->value('href');
        if (is_string($existing) && $existing !== '') {
            return $existing;
        }

        return $this->addresses->shareHrefForPrincipal($principal);
    }

    private function bumpSyncToken(Addressbook $book): void
    {
        Addressbook::query()->where('id', (int) $book->id)->increment('synctoken');
        $book->refresh();
    }
}
