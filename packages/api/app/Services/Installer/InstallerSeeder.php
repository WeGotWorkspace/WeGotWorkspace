<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Contacts\AddressBookProvisioner;
use App\Support\AppPaths;

final class InstallerSeeder
{
    public function __construct(
        private AppPaths $paths,
        private UserCalendarCollectionsProvisioner $calendarCollections,
        private AddressBookProvisioner $addressBooks,
    ) {}

    public function seed(
        string $username,
        string $password,
        string $displayName,
        ?string $email,
        bool $enableCalendars,
        bool $enableContacts,
        bool $isAdmin = false,
    ): void {
        $email = $email !== null && $email !== '' ? $email : $username.'@localhost';
        $hash = password_hash($password, PASSWORD_DEFAULT);

        User::query()->create([
            'username' => $username,
            'digesta1' => '',
            'digest' => $hash,
            'is_admin' => $isAdmin,
        ]);

        $principalUri = 'principals/'.$username;
        Principal::query()->create([
            'uri' => $principalUri,
            'email' => $email,
            'displayname' => $displayName,
        ]);

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
            $this->addressBooks->ensureForPrincipal($principalUri, $displayName);
        }

        $this->ensureUserFilesDirectory($username);
        $this->ensureGroupsContainerPrincipal();
    }

    public function ensureGroupsContainerPrincipal(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
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
