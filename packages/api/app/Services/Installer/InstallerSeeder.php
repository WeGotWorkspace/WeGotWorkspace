<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Support\AppPaths;
use Illuminate\Support\Facades\DB;
use Sabre\CardDAV\Backend\PDO as CardPDO;

final class InstallerSeeder
{
    public function __construct(
        private AppPaths $paths,
        private UserCalendarCollectionsProvisioner $calendarCollections,
    ) {}

    public function seed(
        string $username,
        string $password,
        string $displayName,
        ?string $email,
        bool $enableCalendars,
        bool $enableContacts,
    ): void {
        $email = $email !== null && $email !== '' ? $email : $username.'@localhost';
        $hash = password_hash($password, PASSWORD_DEFAULT);
        if ($hash === false) {
            throw new \RuntimeException('Password hashing failed.');
        }

        User::query()->create([
            'username' => $username,
            'digesta1' => '',
            'digest' => $hash,
        ]);

        $principalUri = 'principals/'.$username;
        Principal::query()->create([
            'uri' => $principalUri,
            'email' => $email,
            'displayname' => $displayName,
        ]);

        $pdo = DB::connection('wgw')->getPdo();

        if ($enableCalendars) {
            Principal::query()->firstOrCreate(
                ['uri' => $principalUri.'/calendar-proxy-read'],
                ['email' => null, 'displayname' => null],
            );
            Principal::query()->firstOrCreate(
                ['uri' => $principalUri.'/calendar-proxy-write'],
                ['email' => null, 'displayname' => null],
            );

            $this->calendarCollections->ensureForPrincipal($principalUri);
        }

        if ($enableContacts) {
            $carddav = new CardPDO($pdo);
            $carddav->createAddressBook($principalUri, 'default', [
                '{DAV:}displayname' => 'Address book',
            ]);
        }

        $this->ensureUserFilesDirectory($username);
        $this->joinAdminGroup($principalUri);
    }

    public function ensureGroupsContainerPrincipal(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
    }

    private function joinAdminGroup(string $memberPrincipalUri): void
    {
        $this->ensureGroupsContainerPrincipal();

        $group = Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::ADMIN_GROUP_URI],
            ['email' => null, 'displayname' => 'Administrators'],
        );
        $member = Principal::query()->where('uri', $memberPrincipalUri)->first();
        if ($member === null) {
            return;
        }

        GroupMember::query()->firstOrCreate([
            'principal_id' => (int) $group->id,
            'member_id' => (int) $member->id,
        ]);
    }

    private function ensureUserFilesDirectory(string $username): void
    {
        $path = rtrim($this->paths->dataDir(), '/').'/files/users/'.$username;
        if (is_dir($path)) {
            return;
        }
        if (! @mkdir($path, 0775, true) && ! is_dir($path)) {
            throw new \RuntimeException('Could not create user files directory for '.$username.'.');
        }
    }
}
