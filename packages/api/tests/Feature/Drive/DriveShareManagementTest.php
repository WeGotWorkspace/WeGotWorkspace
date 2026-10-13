<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Drive\DriveService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareManagementTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'shared.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_owner_can_crud_shares_and_patch_share_with_map(): void
    {
        $token = $this->userBearerToken();

        $create = $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'edit'],
            ],
        ]);
        $create->assertOk();
        $shareId = (string) $create->json('data.id');
        $updatedAt = (string) $create->json('data.updatedAt');
        $this->assertNotSame('', (string) $create->json('data.publicToken'));

        $this->withBearer($token)->getJson('/api/v1/files/shares?path=/users/bob/shared.md')
            ->assertOk()
            ->assertJsonPath('data.0.id', $shareId);

        $patch = $this->withBearer($token)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'shareWith' => [
                'alice' => ['access' => 'full'],
                'carol' => ['access' => 'view'],
            ],
        ]);
        $patch->assertOk()
            ->assertJsonPath('data.defaultAccess', 'view')
            ->assertJsonPath('data.shareWith.alice.access', 'full')
            ->assertJsonPath('data.shareWith.carol.access', 'view');

        $this->withBearer($token)->deleteJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->assertJsonPath('data', 'Deleted');
    }

    public function test_patch_with_stale_updated_at_returns_share_conflict(): void
    {
        $token = $this->userBearerToken();

        $create = $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'view'],
            ],
        ])->assertOk();

        $shareId = (string) $create->json('data.id');
        $stale = $this->withBearer($token)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => '2000-01-01T00:00:00Z',
            'defaultAccess' => 'full',
        ]);

        $stale->assertStatus(409)
            ->assertJsonPath('code', 'share_conflict');
    }

    public function test_non_owner_and_admin_cannot_manage_private_share(): void
    {
        $ownerToken = $this->userBearerToken();
        $carolToken = $this->carolBearerToken();
        $adminToken = $this->adminBearerToken();

        $shareId = (string) $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk()->json('data.id');

        $this->withBearer($carolToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => '2026-01-01T00:00:00Z',
            'defaultAccess' => 'edit',
        ])->assertStatus(404);

        $this->withBearer($adminToken)->deleteJson('/api/v1/files/shares/'.$shareId)
            ->assertStatus(404);
    }

    public function test_shared_with_me_returns_active_member_grants(): void
    {
        $ownerToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $response = $this->withBearer($aliceToken)->getJson('/api/v1/files/shared-with-me');
        $response->assertOk()
            ->assertJsonPath('data.0.share.path', '/users/bob/shared.md')
            ->assertJsonPath('data.0.share.defaultAccess', 'edit')
            ->assertJsonPath('data.0.entry.path', '/users/bob/shared.md')
            ->assertJsonPath('data.0.entry.name', 'shared.md')
            ->assertJsonPath('data.0.entry.type', 'file');
    }

    public function test_shared_with_me_includes_single_file_grant_without_parent_listing(): void
    {
        $ownerToken = $this->userBearerToken();
        $granteeToken = $this->carolBearerToken();

        $this->createDriveFile($ownerToken, '/users/bob', 'Jaap.md');

        $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/Jaap.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($granteeToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertStatus(400);

        $this->withBearer($granteeToken)->get('/api/v1/files/content?path='.urlencode('/users/bob/Jaap.md'))
            ->assertOk();

        $this->withBearer($granteeToken)->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->assertJsonPath('data.0.share.path', '/users/bob/Jaap.md')
            ->assertJsonPath('data.0.share.defaultAccess', 'view')
            ->assertJsonPath('data.0.entry.name', 'Jaap.md')
            ->assertJsonPath('data.0.entry.type', 'file')
            ->assertJsonPath('data.0.entry.myRights.mayView', true)
            ->assertJsonMissingPath('data.0.viaGroup');
    }

    public function test_share_with_email_key_creates_pending_email_grant(): void
    {
        $token = $this->userBearerToken();

        $create = $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'edit'],
                'carol@example.com' => ['access' => 'view'],
            ],
        ]);
        $create->assertOk();

        $shareId = (string) $create->json('data.id');

        $aliceGrant = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_type', 'user')
            ->where('grantee_user', 'alice')
            ->first();
        $this->assertNotNull($aliceGrant);
        $this->assertSame('active', (string) $aliceGrant->status);

        $emailGrant = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_email', 'carol@example.com')
            ->first();
        $this->assertNotNull($emailGrant);
        $this->assertSame('email', (string) $emailGrant->grantee_type);
        $this->assertSame('pending', (string) $emailGrant->status);
        $this->assertNull($emailGrant->getRawOriginal('invite_token'));
        $this->assertNotSame('', (string) $emailGrant->invite_token_cipher);
        $this->assertSame(
            hash('sha256', (string) $emailGrant->invite_token_cipher),
            (string) $emailGrant->invite_token_hash,
        );
        $this->assertNotSame(
            (string) $emailGrant->invite_token_cipher,
            (string) $emailGrant->getRawOriginal('invite_token_cipher'),
        );
        $this->assertNull($emailGrant->grantee_user);
    }

    public function test_duplicate_pending_email_invite_is_idempotent(): void
    {
        $token = $this->userBearerToken();

        $shareId = (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.id');

        $first = $this->withBearer($token)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'view',
        ]);
        $first->assertOk()
            ->assertJsonPath('data.email', 'guest@example.com')
            ->assertJsonPath('data.access', 'view');

        $inviteId = (string) $first->json('data.id');
        $inviteToken = (string) $first->json('data.inviteToken');

        $second = $this->withBearer($token)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'edit',
        ]);
        $second->assertOk()
            ->assertJsonPath('data.id', $inviteId)
            ->assertJsonPath('data.email', 'guest@example.com')
            ->assertJsonPath('data.access', 'edit')
            ->assertJsonPath('data.inviteToken', $inviteToken);

        $grantCount = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_email', 'guest@example.com')
            ->count();
        $this->assertSame(1, $grantCount);

        $grant = DriveShareGrant::query()
            ->where('id', $inviteId)
            ->first();
        $this->assertNotNull($grant);
        $this->assertSame('pending', (string) $grant->status);
        $this->assertSame('edit', (string) $grant->access);
    }

    public function test_duplicate_active_guest_email_invite_returns_share_conflict(): void
    {
        $ownerToken = $this->userBearerToken();
        $guestToken = $this->carolBearerToken();

        $shareId = (string) $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol@example.com' => ['access' => 'view']],
        ])->assertOk()->json('data.id');

        $grant = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_email', 'carol@example.com')
            ->where('status', 'pending')
            ->first();
        $this->assertNotNull($grant);

        $this->withBearer($guestToken)->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => (string) $grant->invite_token_cipher,
        ])->assertOk();

        $duplicate = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'carol@example.com',
            'access' => 'edit',
        ]);

        $duplicate->assertStatus(409)
            ->assertJsonPath('code', 'share_conflict')
            ->assertJsonPath('error', 'Guest already has access.');
    }

    public function test_renaming_folder_rewrites_share_path_prefix(): void
    {
        $token = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        $this->createDriveDirectory('/users/bob', 'SharedFolder');
        $this->createDriveFile($token, '/users/bob/SharedFolder', 'nested.md');

        $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/SharedFolder',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/SharedFolder/nested.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/SharedFolder',
            'RenamedFolder',
        ));

        $this->withBearer($token)
            ->getJson('/api/v1/files/shares?path=/users/bob/RenamedFolder')
            ->assertOk()
            ->assertJsonPath('data.0.path', '/users/bob/RenamedFolder')
            ->assertJsonPath('data.0.shareWith.alice.access', 'edit');

        $this->withBearer($token)
            ->getJson('/api/v1/files/shares?path=/users/bob/RenamedFolder/nested.md')
            ->assertOk()
            ->assertJsonPath('data.0.path', '/users/bob/RenamedFolder/nested.md');

        $this->withBearer($token)
            ->getJson('/api/v1/files/shares?path=/users/bob/SharedFolder')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($aliceToken)
            ->getJson('/api/v1/files/shares/at-path?path=/users/bob/RenamedFolder')
            ->assertOk()
            ->assertJsonPath('data.myRights.mayEditContent', true);
    }

    public function test_email_invite_expires_after_fourteen_days(): void
    {
        $token = $this->userBearerToken();
        $shareId = (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.id');

        $created = $this->withBearer($token)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'view',
        ])->assertOk();

        $grant = DriveShareGrant::query()->where('id', (string) $created->json('data.id'))->first();
        $this->assertNotNull($grant);
        $this->assertNotNull($grant->invite_expires_at);
        $this->assertTrue($grant->invite_expires_at->between(
            Carbon::now()->addDays(14)->subMinutes(2),
            Carbon::now()->addDays(14)->addMinutes(2),
        ));
    }

    public function test_expired_email_invite_returns_gone(): void
    {
        $token = $this->userBearerToken();
        $shareId = (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.id');

        $created = $this->withBearer($token)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'view',
        ])->assertOk();
        $inviteToken = (string) $created->json('data.inviteToken');

        $grant = DriveShareGrant::query()->where('id', (string) $created->json('data.id'))->first();
        $this->assertNotNull($grant);
        $grant->invite_expires_at = Carbon::now()->subMinute();
        $grant->save();

        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => $inviteToken,
        ])->assertStatus(410)
            ->assertJsonPath('code', 'invite_expired');
    }

    public function test_plaintext_tokens_keep_working_after_hash_migration(): void
    {
        $token = $this->userBearerToken();
        $shareId = (string) $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.id');

        $publicToken = 'legacy-public-token-0123456789abcd';
        $publicId = (string) Str::uuid();
        $now = Carbon::now();
        DB::connection('wgw')->table('drive_shares')->insert([
            'id' => $publicId,
            'path' => '/users/bob/shared.md',
            'owner_username' => 'bob',
            'kind' => 'public',
            'default_access' => 'view',
            'public_token' => $publicToken,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $inviteToken = 'example-invite-token';
        $inviteId = (string) Str::uuid();
        DB::connection('wgw')->table('drive_share_grants')->insert([
            'id' => $inviteId,
            'share_id' => $shareId,
            'grantee_type' => 'email',
            'grantee_email' => 'legacy@example.com',
            'access' => 'view',
            'status' => 'pending',
            'invite_token' => $inviteToken,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->loadHashShareTokensMigration()->up();

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk()->assertJsonPath('role', 'guest');

        $publicRow = DriveShare::query()->find($publicId);
        $this->assertNotNull($publicRow);
        $this->assertNull($publicRow->getRawOriginal('public_token'));
        $this->assertSame(hash('sha256', $publicToken), (string) $publicRow->public_token_hash);

        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => $inviteToken,
        ])->assertOk();

        $inviteRow = DriveShareGrant::query()->find($inviteId);
        $this->assertNotNull($inviteRow);
        $this->assertNull($inviteRow->getRawOriginal('invite_token'));
        $this->assertSame('active', (string) $inviteRow->status);
    }

    private function loadHashShareTokensMigration(): object
    {
        $path = database_path('migrations/wgw/2026_10_13_000460_wgw_hash_drive_share_tokens.php');
        $this->assertFileExists($path);
        $copy = tempnam(sys_get_temp_dir(), 'wgw1156');
        $this->assertNotFalse($copy);
        $php = $copy.'.php';
        $this->assertTrue(rename($copy, $php));
        $contents = file_get_contents($path);
        $this->assertNotFalse($contents);
        $this->assertNotFalse(file_put_contents($php, $contents));
        try {
            $migration = require $php;
        } finally {
            unlink($php);
        }
        $this->assertIsObject($migration);

        return $migration;
    }
}
