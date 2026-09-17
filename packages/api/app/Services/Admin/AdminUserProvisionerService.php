<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\GroupMember;
use App\Models\MailUserCredential;
use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\RefreshTokenRepository;
use App\Services\Installer\InstallerSeeder;
use App\Services\Settings\GroupDirectoryService;
use App\Support\AppPaths;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CardDAV\Backend\PDO as CardPDO;

final class AdminUserProvisionerService
{
    public function __construct(
        private GroupDirectoryService $groups,
        private InstallerSeeder $installerSeeder,
        private AppPaths $paths,
        private RefreshTokenRepository $refreshTokens,
    ) {}

    /**
     * @param  list<string>  $groupUris
     */
    public function create(
        string $username,
        string $password,
        string $displayName,
        ?string $email,
        array $groupUris,
        string $actingAdmin,
    ): void {
        $username = strtolower(trim($username));
        $this->assertUsername($username);
        if (strlen($password) < 10) {
            throw new \InvalidArgumentException('Use a password of at least 10 characters.');
        }
        if (User::query()->where('username', $username)->exists()) {
            throw new \InvalidArgumentException('That username is already taken.');
        }

        $cfg = WgwSettings::normalized();
        $enableCalendars = (bool) ($cfg[WgwSettings::CALENDAR_ENABLED] ?? true);
        $enableContacts = (bool) ($cfg[WgwSettings::CONTACTS_ENABLED] ?? true);

        $this->installerSeeder->seed(
            $username,
            $password,
            $displayName !== '' ? $displayName : $username,
            $email,
            $enableCalendars,
            $enableContacts,
        );

        $this->syncGroupMemberships($username, $groupUris, $actingAdmin, skipAdminBootstrap: true);
    }

    /**
     * @param  array{displayName?: string, email?: string, password?: string, groups?: list<string>, enabled?: bool}  $input
     */
    public function update(string $username, array $input, string $actingAdmin): void
    {
        $username = strtolower(trim($username));
        $this->assertUsername($username);
        if (! User::query()->where('username', $username)->exists()) {
            throw new \InvalidArgumentException('User not found.');
        }

        if (array_key_exists('enabled', $input) && $input['enabled'] !== null) {
            $enabled = (bool) $input['enabled'];
            if (! $enabled && $username === strtolower(trim($actingAdmin))) {
                throw new \InvalidArgumentException('You cannot disable your own account.');
            }
            User::query()->where('username', $username)->update(['enabled' => $enabled]);
            if (! $enabled) {
                $this->refreshTokens->revokeAllForUsername($username);
            }
        }

        if (array_key_exists('password', $input) && $input['password'] !== null && $input['password'] !== '') {
            $password = (string) $input['password'];
            if (strlen($password) < 10) {
                throw new \InvalidArgumentException('Use a password of at least 10 characters.');
            }
            $hash = password_hash($password, PASSWORD_DEFAULT);
            if ($hash === false) {
                throw new \RuntimeException('Password hashing failed.');
            }
            User::query()->where('username', $username)->update(['digest' => $hash]);
        }

        if (array_key_exists('displayName', $input) || array_key_exists('email', $input)) {
            $principal = Principal::forUsername($username);
            if ($principal === null) {
                throw new \InvalidArgumentException('No principal row for this user (contacts/calendars may be disabled).');
            }
            if (array_key_exists('displayName', $input)) {
                $displayName = trim((string) $input['displayName']);
                $principal->displayname = $displayName !== '' ? $displayName : null;
            }
            if (array_key_exists('email', $input)) {
                $email = trim((string) ($input['email']));
                $principal->email = $email !== '' ? $email : null;
            }
            $principal->save();
        }

        if (array_key_exists('groups', $input) && is_array($input['groups'])) {
            $this->syncGroupMemberships($username, $input['groups'], $actingAdmin, skipAdminBootstrap: true);
        }
    }

    public function delete(string $username): void
    {
        $username = strtolower(trim($username));
        $this->assertUsername($username);

        $principalUri = 'principals/'.$username;
        $principal = Principal::query()->where('uri', $principalUri)->first();

        if ($principal !== null) {
            $principalId = (int) $principal->id;
            $pdo = DB::connection('wgw')->getPdo();

            if (Schema::connection('wgw')->hasTable('calendars')) {
                $caldav = new CalPDO($pdo);
                foreach ($caldav->getCalendarsForUser($principalUri) as $cal) {
                    if (isset($cal['id']) && is_array($cal['id'])) {
                        $caldav->deleteCalendar($cal['id']);
                    }
                }
            }

            if (Schema::connection('wgw')->hasTable('addressbooks')) {
                $carddav = new CardPDO($pdo);
                foreach ($carddav->getAddressBooksForUser($principalUri) as $book) {
                    if (isset($book['id'])) {
                        $carddav->deleteAddressBook((int) $book['id']);
                    }
                }
            }

            GroupMember::query()
                ->where('member_id', $principalId)
                ->orWhere('principal_id', $principalId)
                ->delete();

            Principal::query()
                ->where('uri', $principalUri)
                ->orWhere('uri', 'like', $principalUri.'/%')
                ->delete();
        }

        User::query()->where('username', $username)->delete();
        if (Schema::connection('wgw')->hasTable('mail_user_credentials')) {
            MailUserCredential::query()->where('username', $username)->delete();
        }

        $userFiles = rtrim($this->paths->dataDir(), '/').'/files/users/'.$username;
        if (is_dir($userFiles)) {
            $this->deleteDirectory($userFiles);
        }
    }

    /**
     * @param  list<string>  $groupUris
     */
    private function syncGroupMemberships(
        string $username,
        array $groupUris,
        string $actingAdmin,
        bool $skipAdminBootstrap,
    ): void {
        $desired = [];
        foreach ($groupUris as $groupUri) {
            $groupUri = trim((string) $groupUri);
            if ($groupUri === '' || ! str_starts_with($groupUri, 'principals/groups/')) {
                continue;
            }
            $desired[$groupUri] = true;
        }

        foreach ($this->groups->listGroupSummaries() as $group) {
            $groupUri = (string) $group['id'];
            $shouldBelong = isset($desired[$groupUri]);
            $members = $this->groups->memberPrincipalUris($groupUri);
            $isMember = in_array('principals/'.$username, $members, true);
            if ($shouldBelong === $isMember) {
                continue;
            }
            $this->groups->setMembership($groupUri, $username, $shouldBelong, $actingAdmin);
        }
    }

    private function assertUsername(string $username): void
    {
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $username)) {
            throw new \InvalidArgumentException('Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.');
        }
    }

    private function deleteDirectory(string $path): void
    {
        if (! is_dir($path)) {
            return;
        }
        $items = scandir($path);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $full = $path.'/'.$item;
            if (is_dir($full)) {
                $this->deleteDirectory($full);
            } else {
                @unlink($full);
            }
        }
        @rmdir($path);
    }
}
