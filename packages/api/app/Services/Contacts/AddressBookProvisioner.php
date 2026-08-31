<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CardDAV\Backend\PDO as CardPDO;

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
                    (string) ($principal?->displayname ?? $username),
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
        if (! Schema::connection('wgw')->hasTable('addressbooks')) {
            return ['created' => 0];
        }

        $carddav = new CardPDO(DB::connection('wgw')->getPdo());
        foreach ($carddav->getAddressBooksForUser($principalUri) as $book) {
            if (($book['uri'] ?? '') === AddressBookCollectionUris::CALDAV_URI) {
                return ['created' => 0];
            }
        }

        $name = trim($displayName);
        if ($name === '') {
            $name = basename(str_replace('\\', '/', $principalUri));
        }

        $carddav->createAddressBook($principalUri, AddressBookCollectionUris::CALDAV_URI, [
            '{DAV:}displayname' => $name,
        ]);

        return ['created' => 1];
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
