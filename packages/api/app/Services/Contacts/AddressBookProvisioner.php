<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Dav\Server\WgwCardBackend;
use App\Models\Addressbook;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use Illuminate\Support\Facades\Schema;
use Sabre\DAV\PropPatch;

/**
 * Eager + lazy one-book-per-principal provision. Backfill helpers are for
 * existing installs only — list/get and create paths call ensure*.
 */
final class AddressBookProvisioner
{
    /**
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllUsers(): array
    {
        if (! Schema::connection('wgw')->hasTable('users') || ! Schema::connection('wgw')->hasTable('addressbooks')) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        User::query()
            ->orderBy('id')
            ->pluck('username')
            ->each(function (mixed $username) use (&$scanned, &$created, &$skipped): void {
                $username = strtolower(trim((string) $username));
                if ($username === '') {
                    return;
                }

                $scanned++;
                $principal = Principal::forUsername($username);
                $result = $this->ensureForPrincipal(
                    'principals/'.$username,
                    (string) ($principal->displayname ?? $username),
                );
                $created += $result['created'];
                if ($result['created'] === 0) {
                    $skipped++;
                }
            });

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    /**
     * @return array{created: int}
     */
    public function ensureForPrincipal(string $principalUri, string $displayName): array
    {
        return ['created' => count($this->ensureForPrincipals([$principalUri => $displayName]))];
    }

    /**
     * {@see ensureForPrincipal()} for several principals, with one read of the books they
     * already have: the JMAP push check asks this for the user and every Team on each
     * request (#2243).
     *
     * @param  array<string, string>  $displayNameByPrincipalUri
     * @return list<string> the principal uris that got a book
     */
    public function ensureForPrincipals(array $displayNameByPrincipalUri): array
    {
        if ($displayNameByPrincipalUri === [] || ! Schema::connection('wgw')->hasTable('addressbooks')) {
            return [];
        }

        // The rows Sabre's getAddressBooksForUser() lists, keyed by the lower-cased principal uri:
        // MySQL compares principal uris without case, as that query did.
        $existing = [];
        foreach (Addressbook::query()
            ->whereIn('principaluri', array_map('strval', array_keys($displayNameByPrincipalUri)))
            ->where('uri', AddressBookCollectionUris::CALDAV_URI)
            ->orderBy('id')
            ->get(['id', 'principaluri', 'displayname']) as $book) {
            $existing[strtolower((string) $book->principaluri)] ??= $book;
        }

        $carddav = null;
        $created = [];
        foreach ($displayNameByPrincipalUri as $principalUri => $displayName) {
            $principalUri = (string) $principalUri;
            $isUserPrincipal = ! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX);
            $book = $existing[strtolower($principalUri)] ?? null;
            if ($book !== null) {
                if ($isUserPrincipal && (string) ($book->displayname ?? '') !== AddressBookCollectionUris::PERSONAL_DISPLAY_NAME) {
                    $this->rewriteUserDisplayName($carddav ??= WgwCardBackend::fromConnection(), (string) $book->id);
                }

                continue;
            }

            $name = $isUserPrincipal
                ? AddressBookCollectionUris::PERSONAL_DISPLAY_NAME
                : trim((string) $displayName);
            if ($name === '') {
                $name = basename(str_replace('\\', '/', $principalUri));
            }
            ($carddav ??= WgwCardBackend::fromConnection())->createAddressBook($principalUri, AddressBookCollectionUris::CALDAV_URI, [
                '{DAV:}displayname' => $name,
            ]);
            $created[] = $principalUri;
        }

        return $created;
    }

    /**
     * Put the personal book's name back to "Personal" after a DAV client
     * renamed it. The rename goes through Sabre's updateAddressBook, like any
     * other, so the book's sync token moves and sharees and DAV clients see it.
     */
    private function rewriteUserDisplayName(WgwCardBackend $carddav, string $bookId): void
    {
        $propPatch = new PropPatch(['{DAV:}displayname' => AddressBookCollectionUris::PERSONAL_DISPLAY_NAME]);
        $carddav->updateAddressBook($bookId, $propPatch);
        $propPatch->commit();
    }

    /**
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllGroups(): array
    {
        if (! Schema::connection('wgw')->hasTable('principals') || ! Schema::connection('wgw')->hasTable('addressbooks')) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        Principal::query()
            ->where('uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->orderBy('id')
            ->get(['uri', 'displayname'])
            ->each(function (Principal $group) use (&$scanned, &$created, &$skipped): void {
                $scanned++;
                if ($this->ensureForGroupPrincipal((string) $group->uri, (string) ($group->displayname ?? ''))) {
                    $created++;
                } else {
                    $skipped++;
                }
            });

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    public function ensureForGroupPrincipal(string $groupPrincipalUri, string $displayName): bool
    {
        if (! str_starts_with($groupPrincipalUri, AdminConstants::GROUP_PREFIX)) {
            return false;
        }

        $slug = substr($groupPrincipalUri, strlen(AdminConstants::GROUP_PREFIX));
        if ($slug === '') {
            return false;
        }

        return $this->ensureForPrincipal($groupPrincipalUri, $displayName)['created'] === 1;
    }
}
