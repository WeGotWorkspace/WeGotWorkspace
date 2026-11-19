<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Models\Principal;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Teams\TeamRoles;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\LegacyAdministratorsTeam;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2278: a Team calendar, task list, notebook or channel is added to the Team, deleted,
 * and moved out of it by a team admin of that Team only.
 *
 * All three are members of Team crew. bob is its team admin. dave is a plain member.
 * alice is organization admin and a member, but not a team admin.
 */
final class TeamCollectionRoleTest extends WgwDatabaseTestCase
{
    private const TEAM = 'crew';

    private const ADD = 'Only a team admin can add a collection to a team.';

    private const DELETE = 'Only a team admin can delete a team collection.';

    private const MOVE_OUT = 'Only a team admin can move a team collection out of its team.';

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        foreach (['alice' => 'Alice', 'bob' => 'Bob', 'dave' => 'Dave'] as $username => $name) {
            $this->seedWgwUser($username, displayName: $name);
        }
        $admins = $this->seedWgwGroup(LegacyAdministratorsTeam::URI, 'Administrators');
        $this->addPrincipalToGroup($admins, $this->principal('alice'));
        $this->grantAdminRole('alice');

        $crew = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Crew');
        foreach (['alice', 'bob', 'dave'] as $username) {
            $this->addPrincipalToGroup($crew, $this->principal($username));
        }
        app(TeamRoles::class)->appoint(self::TEAM, 'bob');
    }

    /**
     * @return array<string, array{0: string, 1: array<string, mixed>}>
     */
    public static function restCollections(): array
    {
        return [
            'task list' => ['/api/v1/tasks/tasklists', []],
            'notebook' => ['/api/v1/notes/notebooks', []],
            'channel' => ['/api/v1/chat/channels', ['kind' => 'channel']],
        ];
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    #[DataProvider('restCollections')]
    public function test_only_a_team_admin_adds_deletes_and_moves_out_a_team_collection(string $path, array $extra): void
    {
        // Add by creating.
        foreach (['dave', 'alice'] as $notTeamAdmin) {
            $this->assertTeamAdminOnly(
                $this->asUser($notTeamAdmin)->postJson($path, ['name' => 'Crew things', 'groupSlug' => self::TEAM, ...$extra]),
                self::ADD,
            );
        }
        $created = $this->asUser('bob')->postJson($path, ['name' => 'Crew things', 'groupSlug' => self::TEAM, ...$extra])
            ->assertCreated()->json();
        $id = (string) $created['id'];
        $this->assertTrue($created['myRights']['mayDelete']);

        // Every member still uses and renames it; only the team admin is offered delete.
        foreach (['dave' => false, 'alice' => false, 'bob' => true] as $username => $mayDelete) {
            $this->asUser($username)->getJson($path.'/'.$id)->assertOk()
                ->assertJsonPath('groupSlug', self::TEAM)
                ->assertJsonPath('myRights.mayDelete', $mayDelete);
        }
        $this->asUser('dave')->patchJson($path.'/'.$id, ['name' => 'Crew renamed'])->assertOk()
            ->assertJsonPath('name', 'Crew renamed');

        // Add by moving a personal one in.
        $personal = (string) $this->asUser('dave')->postJson($path, ['name' => 'Mine', ...$extra])->assertCreated()->json('id');
        $this->assertTeamAdminOnly(
            $this->asUser('dave')->patchJson($path.'/'.$personal, ['groupSlug' => self::TEAM]),
            self::ADD,
        );
        $this->asUser('dave')->getJson($path.'/'.$personal)->assertOk()->assertJsonPath('groupSlug', null);

        // Move out and delete.
        foreach (['dave', 'alice'] as $notTeamAdmin) {
            $this->assertTeamAdminOnly(
                $this->asUser($notTeamAdmin)->patchJson($path.'/'.$id, ['groupSlug' => null]),
                self::MOVE_OUT,
            );
            $this->assertTeamAdminOnly($this->asUser($notTeamAdmin)->deleteJson($path.'/'.$id), self::DELETE);
        }
        $this->asUser('dave')->getJson($path.'/'.$id)->assertOk();
        $this->asUser('bob')->deleteJson($path.'/'.$id)->assertOk();
        $this->asUser('dave')->getJson($path.'/'.$id)->assertNotFound();
    }

    public function test_only_a_team_admin_adds_and_deletes_a_team_calendar(): void
    {
        foreach (['dave', 'alice'] as $notTeamAdmin) {
            $refused = $this->calendarSet($notTeamAdmin, ['create' => ['c' => ['name' => 'Crew calendar', 'groupSlug' => self::TEAM]]]);
            $this->assertSame('forbidden', $refused['notCreated']['c']['type']);
            $this->assertSame(self::ADD, $refused['notCreated']['c']['description']);
        }
        $id = (string) $this->calendarSet('bob', ['create' => ['c' => ['name' => 'Crew calendar', 'groupSlug' => self::TEAM]]])['created']['c']['id'];

        foreach (['dave', 'alice'] as $notTeamAdmin) {
            $refused = $this->calendarSet($notTeamAdmin, ['destroy' => [$id]]);
            $this->assertSame([], $refused['destroyed']);
            $this->assertSame('forbidden', $refused['notDestroyed'][$id]['type']);
            $this->assertSame(self::DELETE, $refused['notDestroyed'][$id]['description']);

            $moved = $this->calendarSet($notTeamAdmin, ['update' => [$id => ['groupSlug' => null]]]);
            $this->assertSame(self::MOVE_OUT, $moved['notUpdated'][$id]['description']);
        }
        $this->assertSame([$id], $this->calendarSet('bob', ['destroy' => [$id]])['destroyed']);
    }

    #[DataProvider('restCollections')]
    public function test_personal_collections_and_team_meetings_are_unchanged(string $path, array $extra): void
    {
        // A plain member creates, renames and deletes their own collections as before.
        $id = (string) $this->asUser('dave')->postJson($path, ['name' => 'Mine', ...$extra])->assertCreated()->json('id');
        $this->asUser('dave')->patchJson($path.'/'.$id, ['name' => 'Still mine'])->assertOk();
        $this->asUser('dave')->deleteJson($path.'/'.$id)->assertOk();

        // A meeting room started with the Team is not a Team collection.
        $this->asUser('dave')->postJson('/api/v1/chat/channels', [
            'name' => 'Stand-up', 'kind' => 'meeting', 'groupSlug' => self::TEAM,
        ])->assertCreated()->assertJsonPath('groupSlug', self::TEAM);

        $own = $this->calendarSet('dave', ['create' => ['c' => ['name' => 'Private']]]);
        $this->assertArrayHasKey('c', $own['created']);
    }

    public function test_a_non_member_is_refused_as_before(): void
    {
        $this->seedWgwUser('erin', displayName: 'Erin');
        app(TeamRoles::class)->appoint(self::TEAM, 'erin');

        $this->asUser('erin')->postJson('/api/v1/notes/notebooks', ['name' => 'Sneaky', 'groupSlug' => self::TEAM])
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden')
            ->assertJsonPath('error', 'Not a member of this team.');
    }

    private function assertTeamAdminOnly(TestResponse $response, string $message): void
    {
        $response->assertForbidden()
            ->assertJsonPath('code', 'team_admin_only')
            ->assertJsonPath('error', $message);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function calendarSet(string $username, array $args): array
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['Calendar/set', ['accountId' => $username, ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0.1');
    }

    private function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }

    private function principal(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }
}
