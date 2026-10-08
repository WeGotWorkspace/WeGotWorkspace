<?php

declare(strict_types=1);

namespace Tests\Feature\Drive\Concerns;

use App\Models\User;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;

/**
 * Alice's shared workspace used by the drive ACL matrix and grantee structure tests.
 */
trait SharedWorkspaceFixture
{
    protected const WORKSPACE = '/users/alice/workspace';

    protected const PLAN = '/users/alice/workspace/plan.md';

    protected const PRIVATE_FILE = '/users/alice/private.md';

    protected const PLAN_BODY = "# Plan\n";

    protected const PRIVATE_BODY = 'alice-only';

    protected const OWNER_TRASH = '/users/alice/.Trash';

    protected const EDITOR_ACCESS = 'full';

    protected const VIEWER_ACCESS = 'view';

    protected string $shareId = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveDirectory('/users/alice', 'workspace');
        app(WgwStorage::class)->files()->put('users/alice/workspace/plan.md', self::PLAN_BODY);
        app(WgwStorage::class)->files()->put('users/alice/private.md', self::PRIVATE_BODY);

        $created = $this->withBearer($this->token('owner'))->postJson('/api/v1/files/shares', [
            'path' => self::WORKSPACE,
            'kind' => 'member',
            'defaultAccess' => self::VIEWER_ACCESS,
            'shareWith' => [
                'bob' => ['access' => self::EDITOR_ACCESS],
                'carol' => ['access' => self::VIEWER_ACCESS],
            ],
        ]);
        $created->assertOk()
            ->assertJsonPath('data.shareWith.bob.access', self::EDITOR_ACCESS)
            ->assertJsonPath('data.shareWith.carol.access', self::VIEWER_ACCESS);
        $this->shareId = (string) $created->json('data.id');
        $this->assertNotSame('', $this->shareId);
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    protected function token(string $role): string
    {
        return match ($role) {
            'owner' => $this->adminBearerToken(),
            'editor' => $this->userBearerToken(),
            'viewer' => $this->carolBearerToken(),
            'dave' => $this->issueBearerTokenFor('dave'),
            default => $this->fail('Unknown role '.$role),
        };
    }

    protected function accountId(string $role): string
    {
        return match ($role) {
            'owner' => 'alice',
            'editor' => 'bob',
            'viewer' => 'carol',
            'dave' => 'dave',
            default => $this->fail('Unknown role '.$role),
        };
    }

    protected function listWorkspace(string $role): TestResponse
    {
        return $this->withBearer($this->token($role))
            ->getJson('/api/v1/files/children?path='.urlencode(self::WORKSPACE));
    }

    protected function download(string $path, string $role): TestResponse
    {
        return $this->withBearer($this->token($role))
            ->get('/api/v1/files/content?path='.urlencode($path));
    }

    protected function readCollab(string $path, string $role): TestResponse
    {
        return $this->withBearer($this->token($role))
            ->get('/api/v1/files/collaboration?path='.urlencode($path));
    }

    protected function writeCollab(string $path, string $role, string $markdown): TestResponse
    {
        return $this->withBearer($this->token($role))
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => $markdown,
            ]);
    }

    protected function shareUpdatedAt(): string
    {
        return (string) $this->withBearer($this->token('owner'))
            ->getJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk()
            ->json('data.updatedAt');
    }

    /**
     * @param  array{access: string}|null  $grant
     */
    protected function patchGrant(string $username, ?array $grant): void
    {
        $this->withBearer($this->token('owner'))->patchJson('/api/v1/files/shares/'.$this->shareId, [
            'updatedAt' => $this->shareUpdatedAt(),
            'shareWith' => [$username => $grant],
        ])->assertOk();
    }

    protected function workspaceNodeId(): string
    {
        return $this->fileNodeIdByName(
            $this->fileNodeGetAll('alice', $this->token('owner')),
            'workspace',
        );
    }

    protected function planNodeId(): string
    {
        return $this->fileNodeIdByName(
            $this->fileNodeGetAll('alice', $this->token('owner')),
            'plan.md',
        );
    }

    protected function seedDave(): void
    {
        if (User::query()->where('username', 'dave')->exists()) {
            return;
        }

        $this->seedWgwUser('dave', displayName: 'Dave', email: 'dave@example.com');
    }

    protected function ensureActorTrashNodeId(string $role): string
    {
        $username = $this->accountId($role);
        $this->ensureTrashDirectory($this->token($role), $username);

        return $this->fileNodeIdByName(
            $this->fileNodeGetAll($username, $this->token($role)),
            '.Trash',
        );
    }

    protected function moveNode(string $role, string $nodeId, string $parentId): TestResponse
    {
        return $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => $this->accountId($role), 'update' => [
                $nodeId => ['parentId' => $parentId],
            ]], 'm0'],
        ], $this->token($role));
    }

    protected function assertRevoked(string $role): void
    {
        $this->listWorkspace($role)
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->download(self::PLAN, $role)
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
        $this->readCollab(self::PLAN, $role)
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
        $this->writeCollab(self::PLAN, $role, "after revoke\n")
            ->assertForbidden();
    }
}
