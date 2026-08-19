<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Notes\NoteMarkdownCodec;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;

/**
 * Shared disk + identity fixtures for Notes FileNode / share tests.
 */
trait NotesTestFixtures
{
    use WgwRoleFixtures;

    private string $notesDataDir = '';

    protected function setUpNotesFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->notesDataDir = storage_path('framework/testing/wgw-notes-'.uniqid('', true));
        File::ensureDirectoryExists($this->notesDataDir.'/files/users/bob');
        File::ensureDirectoryExists($this->notesDataDir.'/files/users/alice');
        File::ensureDirectoryExists($this->notesDataDir.'/files/users/carol');
        File::ensureDirectoryExists($this->notesDataDir.'/files/groups/team');

        WgwTestDisks::refresh($this->notesDataDir);
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedNotesRoleMatrix();
    }

    protected function tearDownNotesFixtures(): void
    {
        if ($this->notesDataDir !== '' && File::isDirectory($this->notesDataDir)) {
            File::deleteDirectory($this->notesDataDir);
        }
    }

    protected function seedNotesRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);
        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);

        // Shared notebook group: only bob is a member. alice (admin) and carol
        // are deliberately excluded so tests can assert non-members get 403 and
        // that admin does not bypass group membership.
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $this->addPrincipalToGroup($team, $bob);
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function notesDataDirectory(): string
    {
        return $this->notesDataDir;
    }

    /**
     * Seed a note markdown file on disk (FileNode index lazy-heals).
     *
     * @param  array<string, mixed>  $overrides
     * @return array{id: string, item: array<string, mixed>, path: string, key: string}
     */
    protected function createNoteFor(
        string $token,
        array $overrides = [],
    ): array {
        unset($token);
        $id = preg_replace('/[^A-Za-z0-9._-]/', '', (string) ($overrides['id'] ?? ('note-'.uniqid('', true)))) ?: 'note';
        $notebook = trim((string) ($overrides['notebook'] ?? 'Drafts'));
        $notebook = $notebook !== '' ? $notebook : 'Drafts';
        $body = (string) ($overrides['body'] ?? 'Body text');
        $title = (string) ($overrides['title'] ?? 'Untitled');
        $tags = is_array($overrides['tags'] ?? null)
            ? array_values(array_filter($overrides['tags'], is_string(...)))
            : ['demo'];
        $username = (string) ($overrides['username'] ?? 'bob');
        $groupSlug = isset($overrides['groupSlug']) && is_string($overrides['groupSlug'])
            ? trim($overrides['groupSlug'])
            : '';
        $root = $groupSlug !== '' ? 'groups/'.$groupSlug : 'users/'.$username;
        $key = $root.'/.notes/'.$notebook.'/'.$id.'.md';
        $codec = new NoteMarkdownCodec;
        $markdown = $codec->serialize($title, $tags, $body);
        app(WgwStorage::class)->files()->put($key, $markdown);

        return [
            'id' => $id,
            'path' => '/'.$key,
            'key' => $key,
            'item' => [
                'id' => $id,
                'notebook' => $notebook,
                'body' => $body,
                'tags' => $tags,
                'updatedAt' => $codec->updatedOf($markdown),
            ],
        ];
    }
}
