<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Installer\InstallerSeeder;
use App\Services\Notes\GroupNotesHomesProvisioner;
use App\Services\Settings\GroupDirectoryService;
use App\Support\AppPaths;

final class AdminGroupManagementService
{
    public function __construct(
        private GroupDirectoryService $groups,
        private InstallerSeeder $installerSeeder,
        private UserCalendarCollectionsProvisioner $calendarCollections,
        private GroupNotesHomesProvisioner $notesHomes,
        private AppPaths $paths,
    ) {}

    public function create(string $slug, string $displayName): string
    {
        $slug = $this->normalizeSlug($slug);
        $uri = AdminConstants::GROUP_PREFIX.$slug;

        if (Principal::query()->where('uri', $uri)->exists()) {
            throw new \InvalidArgumentException('That group already exists.');
        }

        $this->installerSeeder->ensureGroupsContainerPrincipal();

        Principal::query()->create([
            'uri' => $uri,
            'email' => null,
            'displayname' => $displayName !== '' ? $displayName : $slug,
        ]);

        $this->notesHomes->ensureForSlug($slug);
        $this->calendarCollections->ensureForGroupPrincipal($uri, $displayName !== '' ? $displayName : $slug);

        return $uri;
    }

    /**
     * @param  list<string>|null  $members  Usernames or principal URIs
     */
    public function update(string $groupSlug, ?string $displayName, ?array $members, string $actingAdmin): void
    {
        $uri = $this->groupUriFromSlug($groupSlug);
        $principal = Principal::query()->where('uri', $uri)->first();
        if ($principal === null) {
            throw new \InvalidArgumentException('Group not found.');
        }

        if ($displayName !== null) {
            $name = trim($displayName);
            $principal->displayname = $name !== '' ? $name : basename($uri);
            $principal->save();
        }

        if ($members !== null) {
            $this->groups->replaceMembers($uri, $members, $actingAdmin);
        }
    }

    public function delete(string $groupSlug): void
    {
        $uri = $this->groupUriFromSlug($groupSlug);
        if ($uri === AdminConstants::ADMIN_GROUP_URI) {
            throw new \InvalidArgumentException('The administrators group cannot be deleted.');
        }

        $principal = Principal::query()->where('uri', $uri)->first();
        if ($principal === null) {
            throw new \InvalidArgumentException('Group not found.');
        }

        GroupMember::query()
            ->where('principal_id', $principal->id)
            ->orWhere('member_id', $principal->id)
            ->delete();

        $principal->delete();

        $slug = basename(str_replace('\\', '/', $uri));
        $groupFiles = rtrim($this->paths->dataDir(), '/').'/files/groups/'.$slug;
        if (is_dir($groupFiles)) {
            $this->deleteDirectory($groupFiles);
        }
    }

    public function normalizeSlug(string $raw): string
    {
        $slug = strtolower(trim($raw));
        $slug = preg_replace('/[^a-z0-9_-]+/', '-', $slug) ?? '';
        $slug = trim($slug, '-');
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $slug)) {
            throw new \InvalidArgumentException('Group slug must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.');
        }

        return $slug;
    }

    private function groupUriFromSlug(string $groupSlug): string
    {
        $groupSlug = trim($groupSlug);
        if (str_starts_with($groupSlug, AdminConstants::GROUP_PREFIX)) {
            return $groupSlug;
        }

        return AdminConstants::GROUP_PREFIX.$this->normalizeSlug($groupSlug);
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
