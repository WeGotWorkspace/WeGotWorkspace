<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Exceptions\ApiHttpException;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Settings\GroupDirectoryService;
use App\Services\Teams\TeamColleagues;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\WgwDatabaseTestCase;

final class TeamColleaguesTest extends WgwDatabaseTestCase
{
    /** @var array<string, Principal> */
    private array $users = [];

    /** @var array<string, Principal> */
    private array $teams = [];

    protected function setUp(): void
    {
        parent::setUp();

        foreach (['alice', 'bob', 'carol', 'dave', 'root'] as $username) {
            $this->seedWgwUser($username);
            $principal = Principal::forUsername($username);
            self::assertNotNull($principal);
            $this->users[$username] = $principal;
        }
        $this->teams['t1'] = $this->seedWgwGroup('principals/groups/t1', 'Team One');
        $this->teams['t2'] = $this->seedWgwGroup('principals/groups/t2', 'Team Two');
        $this->teams['admins'] = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');

        // alice–bob share T1, bob–carol share T2, dave is in no Team, root is admin only.
        $this->join('t1', 'alice');
        $this->join('t1', 'bob');
        $this->join('t2', 'bob');
        $this->join('t2', 'carol');
        $this->join('admins', 'root');
    }

    public function test_users_who_share_a_team_are_colleagues(): void
    {
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->isColleague('alice', 'bob'));
        self::assertTrue($colleagues->isColleague('bob', 'alice'));
        self::assertTrue($colleagues->sharesTeamIgnoringAdminRole('alice', 'bob'));
        self::assertTrue($colleagues->colleagues('alice')->contains('bob'));
        self::assertFalse($colleagues->colleagues('alice')->isUnrestricted());
    }

    public function test_users_without_a_shared_team_are_not_colleagues(): void
    {
        $colleagues = $this->colleagues();

        self::assertFalse($colleagues->isColleague('alice', 'dave'));
        self::assertFalse($colleagues->sharesTeamIgnoringAdminRole('alice', 'dave'));
        self::assertFalse($colleagues->colleagues('alice')->contains('dave'));
        self::assertFalse($colleagues->isColleague('alice', 'nobody'));
    }

    public function test_a_user_in_no_team_has_no_colleagues_but_themself(): void
    {
        $set = $this->colleagues()->colleagues('dave');

        self::assertFalse($set->isUnrestricted());
        self::assertSame(['dave'], $set->usernames());
        self::assertFalse($set->contains('alice'));
        self::assertFalse($set->contains('root'));
    }

    public function test_admin_is_a_colleague_of_everyone_but_shares_only_their_own_teams(): void
    {
        $colleagues = $this->colleagues();
        $set = $colleagues->colleagues('root');

        self::assertTrue($set->isUnrestricted());
        self::assertTrue($set->contains('dave'));
        self::assertTrue($colleagues->isColleague('root', 'alice'));
        self::assertTrue($colleagues->isColleague('root', 'dave'));
        self::assertFalse($colleagues->sharesTeamIgnoringAdminRole('root', 'alice'));
        self::assertFalse($colleagues->sharesTeamIgnoringAdminRole('root', 'dave'));
        self::assertFalse($colleagues->isOwnTeam('root', 't1'));
        self::assertTrue($colleagues->isOwnTeam('root', 'administrators'));
        // usernames() lists real Team mates, so an unrestricted set still names only them.
        self::assertSame(['root'], $set->usernames());
        // The admin role is one-sided: a user outside root's Teams does not see root as a colleague.
        self::assertFalse($colleagues->isColleague('alice', 'root'));
    }

    public function test_admin_shares_with_users_in_their_own_teams(): void
    {
        $this->join('t1', 'root');
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->sharesTeamIgnoringAdminRole('root', 'alice'));
        self::assertTrue($colleagues->isOwnTeam('root', 't1'));
        self::assertSame(['alice', 'bob', 'root'], $colleagues->colleagues('root')->usernames());
    }

    public function test_self_is_always_a_colleague(): void
    {
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->isColleague('alice', 'alice'));
        self::assertTrue($colleagues->isColleague('dave', 'dave'));
        self::assertTrue($colleagues->sharesTeamIgnoringAdminRole('dave', 'dave'));
        self::assertTrue($colleagues->colleagues('dave')->contains('dave'));
    }

    public function test_colleagues_are_not_transitive(): void
    {
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->isColleague('alice', 'bob'));
        self::assertTrue($colleagues->isColleague('bob', 'carol'));
        self::assertFalse($colleagues->isColleague('alice', 'carol'));
        self::assertFalse($colleagues->isColleague('carol', 'alice'));
        self::assertSame(['alice', 'bob', 'carol'], $colleagues->colleagues('bob')->usernames());
        self::assertSame(['alice', 'bob'], $colleagues->colleagues('alice')->usernames());
    }

    public function test_usernames_are_matched_case_insensitively(): void
    {
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->isColleague('Alice', 'BOB'));
        self::assertTrue($colleagues->colleagues(' alice ')->contains('Bob'));
    }

    public function test_own_teams_follow_real_membership(): void
    {
        $colleagues = $this->colleagues();

        self::assertTrue($colleagues->isOwnTeam('alice', 't1'));
        self::assertFalse($colleagues->isOwnTeam('alice', 't2'));
        self::assertFalse($colleagues->isOwnTeam('alice', 'missing'));
        self::assertFalse($colleagues->isOwnTeam('dave', 't1'));
    }

    public function test_group_members_of_a_team_are_not_colleagues(): void
    {
        // A nested group principal in a Team is not a user.
        $this->addPrincipalToGroup($this->teams['t1'], $this->teams['t2']);

        self::assertSame(['alice', 'bob'], $this->colleagues()->colleagues('alice')->usernames());
    }

    public function test_assert_may_share_with_refuses_like_an_unknown_principal(): void
    {
        $colleagues = $this->colleagues();
        $colleagues->assertMayShareWith('alice', 'bob');

        $refused = $this->refusal(fn () => $colleagues->assertMayShareWith('alice', 'dave'));
        $unknown = $this->refusal(fn () => $colleagues->assertMayShareWith('alice', 'nobody'));
        $admin = $this->refusal(fn () => $colleagues->assertMayShareWith('root', 'alice'));

        foreach ([$refused, $unknown, $admin] as $exception) {
            self::assertSame(400, $exception->getStatusCode());
            self::assertSame('Unknown or invalid share principal.', $exception->getMessage());
            self::assertSame('invalidProperties', $exception->errorCode());
        }
        self::assertSame(['shareWith/dave'], $refused->invalidProperties());
        self::assertSame(['shareWith/nobody'], $unknown->invalidProperties());
    }

    public function test_assert_may_share_with_throws_the_callers_unknown_exception(): void
    {
        $unknown = new ApiHttpException(400, 'Unknown or invalid DM principal.', 'invalidProperties', ['principal']);

        $refused = $this->refusal(fn () => $this->colleagues()->assertMayShareWith('alice', 'dave', $unknown));

        self::assertSame($unknown, $refused);
    }

    public function test_the_set_is_one_query_and_memoised_within_a_request(): void
    {
        $colleagues = $this->colleagues();
        DB::connection('wgw')->enableQueryLog();
        DB::connection('wgw')->flushQueryLog();

        $colleagues->colleagues('alice');
        $colleagues->isColleague('alice', 'bob');
        $colleagues->isColleague('alice', 'dave');
        $colleagues->sharesTeamIgnoringAdminRole('alice', 'carol');
        $colleagues->colleagues('alice');

        $queries = array_map(
            static fn (array $entry): string => (string) $entry['query'],
            DB::connection('wgw')->getQueryLog(),
        );
        DB::connection('wgw')->disableQueryLog();

        $selfJoins = array_filter($queries, static fn (string $sql): bool => preg_match_all('/(?:from|join)\s+[`"]?groupmembers[`"]?/i', $sql) >= 2);
        self::assertCount(1, $selfJoins, implode("\n", $queries));
        // The self-join plus one admin role lookup.
        self::assertCount(2, $queries, implode("\n", $queries));
    }

    public function test_a_membership_change_takes_effect_on_the_next_request(): void
    {
        $colleagues = $this->colleagues();
        self::assertFalse($colleagues->isColleague('alice', 'dave'));
        self::assertFalse($colleagues->isColleague('dave', 'alice'));

        $this->join('t1', 'dave');
        $this->startNextRequest();

        self::assertTrue($colleagues->isColleague('alice', 'dave'));
        self::assertTrue($this->colleagues()->isColleague('dave', 'alice'));
        self::assertTrue($this->colleagues()->isOwnTeam('dave', 't1'));

        GroupMember::query()
            ->where('principal_id', $this->teams['t1']->id)
            ->where('member_id', $this->users['dave']->id)
            ->delete();
        $this->startNextRequest();

        self::assertFalse($colleagues->isColleague('alice', 'dave'));
        self::assertFalse($colleagues->isOwnTeam('dave', 't1'));
    }

    public function test_an_admin_role_change_takes_effect_on_the_next_request(): void
    {
        $colleagues = $this->colleagues();
        self::assertTrue($colleagues->isColleague('root', 'dave'));

        GroupMember::query()
            ->where('principal_id', $this->teams['admins']->id)
            ->where('member_id', $this->users['root']->id)
            ->delete();
        $this->startNextRequest();

        self::assertFalse($colleagues->isColleague('root', 'dave'));
    }

    public function test_the_service_is_one_instance_per_request(): void
    {
        self::assertSame($this->colleagues(), $this->colleagues());
    }

    public function test_drive_group_slugs_and_settings_groups_read_the_same_membership(): void
    {
        $this->join('t2', 'alice');

        self::assertSame(['t1', 't2'], $this->app->make(DriveGroupResolver::class)->allowedGroupSlugs('alice'));
        self::assertSame([], $this->app->make(DriveGroupResolver::class)->allowedGroupSlugs('dave'));
        self::assertSame(
            [
                ['id' => 'principals/groups/t1', 'displayName' => 'Team One'],
                ['id' => 'principals/groups/t2', 'displayName' => 'Team Two'],
            ],
            $this->app->make(GroupDirectoryService::class)->groupsForUser('alice'),
        );
    }

    public function test_settings_groups_for_user_is_one_query(): void
    {
        $this->join('t2', 'alice');
        $directory = $this->app->make(GroupDirectoryService::class);
        DB::connection('wgw')->enableQueryLog();
        DB::connection('wgw')->flushQueryLog();

        $directory->groupsForUser('alice');

        $count = count(DB::connection('wgw')->getQueryLog());
        DB::connection('wgw')->disableQueryLog();
        self::assertSame(1, $count);
    }

    public function test_settings_groups_fall_back_to_the_slug_without_a_display_name(): void
    {
        $unnamed = $this->seedWgwGroup('principals/groups/unnamed', '');
        $this->addPrincipalToGroup($unnamed, $this->users['dave']);

        self::assertSame(
            [['id' => 'principals/groups/unnamed', 'displayName' => 'unnamed']],
            $this->app->make(GroupDirectoryService::class)->groupsForUser('dave'),
        );
    }

    private function colleagues(): TeamColleagues
    {
        return $this->app->make(TeamColleagues::class);
    }

    private function join(string $team, string $username): void
    {
        $this->addPrincipalToGroup($this->teams[$team], $this->users[$username]);
    }

    /** The HTTP kernel rebinds `request` at the start of every request. */
    private function startNextRequest(): void
    {
        $this->app->instance('request', Request::create('/'));
    }

    private function refusal(callable $call): ApiHttpException
    {
        try {
            $call();
        } catch (ApiHttpException $exception) {
            return $exception;
        }
        self::fail('Expected an ApiHttpException.');
    }
}
