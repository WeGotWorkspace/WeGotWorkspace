<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\DriveShareTool;
use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Mcp\McpScopes;
use Illuminate\Http\Request;
use Illuminate\Testing\TestResponse;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk D of Epic #1915 for Drive and Docs: a member grant to someone outside the caller's
 * Teams, or to a Team the caller is not in, is refused like an unknown user or Team, over
 * REST and MCP, admins included. Email (guest) invites are unchanged.
 *
 * Fixture: bob and alice share "team"; alice is admin; carol is alone in "other".
 */
final class TeamDriveShareGatesTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use DriveTestFixtures;
    use RefusedLikeUnknown;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $other = $this->seedWgwGroup('principals/groups/other', 'Other');
        $carol = Principal::forUsername('carol');
        $this->assertNotNull($carol);
        $this->addPrincipalToGroup($other, $carol);
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'gate.md');
        $this->createDriveFile($this->adminBearerToken(), '/users/alice', 'gate.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_creating_a_member_share_refuses_non_colleagues_like_unknown(): void
    {
        $create = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->postJson('/api/v1/files/shares', [
                'path' => '/users/'.$caller.'/gate.md',
                'kind' => 'member',
                'shareWith' => [$target => ['access' => 'view']],
            ]);

        $this->assertRefusedLikeUnknown($create, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($create, 'bob', 'groups/other', 'groups/nope');
        $this->assertRefusedLikeUnknown($create, 'alice', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($create, 'alice', 'groups/other', 'groups/nope');
        $create('bob', 'carol')->assertStatus(400)->assertExactJson(['error' => 'Unknown user.', 'code' => 'bad_request']);
        $this->assertSame(0, DriveShareGrant::query()->count());

        $create('bob', 'alice')->assertOk()->assertJsonPath('data.shareWith.alice.access', 'view');
        $create('alice', 'groups/team')->assertOk();
    }

    public function test_updating_a_member_share_refuses_non_colleagues_like_unknown(): void
    {
        $shares = [];
        foreach (['alice', 'bob'] as $owner) {
            $shares[$owner] = $this->asUser($owner)->postJson('/api/v1/files/shares', [
                'path' => '/users/'.$owner.'/gate.md',
                'kind' => 'member',
            ])->assertOk()->json('data.id');
        }
        $update = fn (string $caller, string $target): TestResponse => $this->asUser($caller)
            ->patchJson('/api/v1/files/shares/'.$shares[$caller], [
                'updatedAt' => $this->updatedAt($caller, (string) $shares[$caller]),
                'shareWith' => [$target => ['access' => 'edit']],
            ]);

        $this->assertRefusedLikeUnknown($update, 'bob', 'carol', 'ghost');
        $this->assertRefusedLikeUnknown($update, 'bob', 'groups/other', 'groups/nope');
        $this->assertRefusedLikeUnknown($update, 'alice', 'carol', 'ghost');
        $update('bob', 'alice')->assertOk();
    }

    public function test_mcp_drive_share_refuses_non_colleagues_like_unknown(): void
    {
        $this->enableMcp();
        $client = $this->mcpClient();

        foreach (['bob' => 'carol', 'alice' => 'carol'] as $caller => $refused) {
            $user = User::query()->where('username', $caller)->firstOrFail();
            Passport::actingAs($user, [McpScopes::DRIVE_SHARE], 'api', $client);
            foreach ([[$refused, 'ghost', 'Unknown user.'], ['groups/other', 'groups/nope', 'Unknown group.']] as [$target, $unknown, $message]) {
                foreach ([$target, $unknown] as $name) {
                    WorkspaceServer::actingAs($user, 'api')
                        ->tool(DriveShareTool::class, [
                            'action' => 'set',
                            'path' => '/users/'.$caller.'/gate.md',
                            'kind' => 'member',
                            'shareWith' => [$name => ['access' => 'view']],
                        ])
                        ->assertHasErrors([$message]);
                }
            }
        }
        $this->assertSame(0, DriveShareGrant::query()->count());
    }

    public function test_guest_invites_by_email_are_unchanged(): void
    {
        $this->asUser('bob')->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/gate.md',
            'kind' => 'member',
            'shareWith' => ['carol@example.test' => ['access' => 'view']],
        ])->assertOk();

        $this->assertSame(1, DriveShareGrant::query()->where('grantee_type', 'email')->count());
    }

    public function test_existing_grants_to_a_former_colleague_are_not_touched(): void
    {
        $shareId = (string) $this->asUser('bob')->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/gate.md',
            'kind' => 'member',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk()->json('data.id');
        $grant = DriveShareGrant::query()->where('grantee_user', 'alice')->firstOrFail()->getAttributes();

        // alice leaves "team": a new grant for her is refused, and her old grant stays as it is.
        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/team')->value('id'))
            ->where('member_id', Principal::forUsername('alice')?->id)
            ->delete();
        $this->app->instance('request', Request::create('/'));

        $this->asUser('bob')->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $this->updatedAt('bob', $shareId),
            'shareWith' => ['alice' => ['access' => 'full']],
        ])->assertStatus(400)->assertJsonPath('error', 'Unknown user.');
        $this->asUser('bob')->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $this->updatedAt('bob', $shareId),
            'shareWith' => ['carol@example.test' => ['access' => 'view']],
        ])->assertOk();

        $this->assertSame($grant, DriveShareGrant::query()->where('grantee_user', 'alice')->firstOrFail()->getAttributes());
        $this->assertSame(2, DriveShareGrant::query()->count());
    }

    private function updatedAt(string $owner, string $shareId): string
    {
        return (string) $this->asUser($owner)->getJson('/api/v1/files/shares/'.$shareId)->assertOk()->json('data.updatedAt');
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
