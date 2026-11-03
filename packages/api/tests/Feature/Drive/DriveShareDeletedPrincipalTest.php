<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Deleting a user or group ends its drive shares for good. The user's own shares are revoked,
 * and grants made to the user or group are removed, so a new account or group under the same
 * name starts with nothing.
 */
final class DriveShareDeletedPrincipalTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_deleting_a_user_revokes_the_shares_they_own(): void
    {
        $bob = $this->userBearerToken();
        $ownPath = $this->seedPrivateFile('bob', 'own.md', 'own body');
        $groupPath = $this->seedGroupFile('box/doc.md', 'team body');
        $ownShareId = $this->memberShare($bob, $ownPath, ['carol' => ['access' => 'view']]);
        $groupShareId = $this->memberShare($bob, '/groups/team/box', ['carol' => ['access' => 'view']]);
        $publicToken = (string) $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => $ownPath,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $aliceShareId = $this->memberShare(
            $this->adminBearerToken(),
            $this->seedPrivateFile('alice', 'hers.md', 'her body'),
            ['carol' => ['access' => 'view']],
        );

        $this->deleteUser('bob');

        $this->assertSame(
            [$aliceShareId],
            DriveShare::query()->whereNull('revoked_at')->pluck('id')->map(fn ($id): string => (string) $id)->all(),
            'Only the deleted user\'s shares are revoked.',
        );

        $this->recreateBob(groups: ['principals/groups/team']);
        $this->seedPrivateFile('bob', 'own.md', 'new own body');
        $carol = $this->carolBearerToken();

        $this->withBearer($this->issueBearerTokenFor('bob', 'secret-for-new-bob'))->getJson('/api/v1/files/shares/'.$ownShareId)
            ->assertNotFound();
        $this->withBearer($this->issueBearerTokenFor('bob', 'secret-for-new-bob'))->getJson('/api/v1/files/shares/'.$groupShareId)
            ->assertNotFound();
        $this->assertAccessDenied($this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode($ownPath)));
        $this->assertAccessDenied($this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode($groupPath)));
        $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertStatus(410)
            ->assertJsonPath('code', 'share_unavailable');
        $this->assertSame([$aliceShareId], $this->sharedWithShareIds($carol));
    }

    public function test_deleting_a_user_removes_what_was_shared_with_them(): void
    {
        $carolPath = $this->seedPrivateFile('carol', 'for-bob.md', 'carol body');
        $carolShareId = $this->memberShare($this->carolBearerToken(), $carolPath, [
            'bob' => ['access' => 'view'],
            'alice' => ['access' => 'view'],
        ]);

        $this->deleteUser('bob');

        $this->assertSame(
            ['alice'],
            DriveShareGrant::query()->where('share_id', $carolShareId)->pluck('grantee_user')->all(),
        );

        $this->recreateBob(groups: []);
        $newBob = $this->issueBearerTokenFor('bob', 'secret-for-new-bob');

        $this->assertAccessDenied($this->withBearer($newBob)->get('/api/v1/files/content?path='.urlencode($carolPath)));
        $this->assertSame([], $this->sharedWithShareIds($newBob));
        $this->withBearer($this->adminBearerToken())->get('/api/v1/files/content?path='.urlencode($carolPath))
            ->assertOk();
    }

    public function test_deleting_a_group_removes_what_was_shared_with_it(): void
    {
        $admin = $this->adminBearerToken();
        $this->withBearer($admin)->postJson('/api/v1/admin/groups', ['name' => 'crew'])->assertOk();
        $carolPath = $this->seedPrivateFile('carol', 'for-crew.md', 'carol body');
        $carolShareId = $this->memberShare($this->carolBearerToken(), $carolPath, [
            'groups/crew' => ['access' => 'view'],
            'groups/team' => ['access' => 'view'],
        ]);

        $this->withBearer($admin)->deleteJson('/api/v1/admin/groups/crew')->assertOk();

        $this->assertSame(
            ['team'],
            DriveShareGrant::query()->where('share_id', $carolShareId)->pluck('grantee_group')->all(),
        );

        $this->withBearer($admin)->postJson('/api/v1/admin/groups', ['name' => 'crew'])->assertOk();
        $this->withBearer($admin)->putJson('/api/v1/admin/groups/crew/members/bob')->assertOk();
        $this->withBearer($admin)->deleteJson('/api/v1/admin/groups/team/members/bob')->assertOk();

        $this->assertAccessDenied(
            $this->withBearer($this->userBearerToken())->get('/api/v1/files/content?path='.urlencode($carolPath))
        );
        $this->withBearer($admin)->get('/api/v1/files/content?path='.urlencode($carolPath))->assertOk();
    }

    /**
     * @param  array<string, array{access: string}>  $shareWith
     */
    private function memberShare(string $token, string $path, array $shareWith): string
    {
        return (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => $shareWith,
        ])->assertOk()->json('data.id');
    }

    private function deleteUser(string $username): void
    {
        $this->withBearer($this->adminBearerToken())->deleteJson('/api/v1/admin/users/'.$username)->assertOk();
    }

    /**
     * @param  list<string>  $groups
     */
    private function recreateBob(array $groups): void
    {
        $this->withBearer($this->adminBearerToken())->postJson('/api/v1/admin/users', [
            'username' => 'bob',
            'password' => 'secret-for-new-bob',
            'displayName' => 'New Bob',
            'groups' => $groups,
        ])->assertOk();
    }

    /**
     * @return list<string>
     */
    private function sharedWithShareIds(string $token): array
    {
        $rows = (array) $this->withBearer($token)->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->json('data');

        return array_values(array_map(static fn (mixed $row): string => (string) ($row['share']['id'] ?? ''), $rows));
    }
}
