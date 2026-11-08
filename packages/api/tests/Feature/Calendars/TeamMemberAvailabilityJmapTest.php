<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\Availability\AvailabilitySettings;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\AvailabilityTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1909: TeamMember/get and TeamMember/getAvailability. Who may see whom,
 * one `notFound` for every refusal, limits before any read, excludeEventId.
 */
final class TeamMemberAvailabilityJmapTest extends WgwDatabaseTestCase
{
    use AvailabilityTestFixtures;

    private const WEEK_START = '2030-01-07T00:00:00Z';

    private const WEEK_END = '2030-01-14T00:00:00Z';

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAvailabilityFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAvailabilityFixtures();
        parent::tearDown();
    }

    public function test_session_advertises_the_capability_and_limits(): void
    {
        $session = $this->withBearer($this->token('carol'))->getJson('/api/v1/jmap/session')->assertOk();

        $this->assertSame([], $session->json('capabilities.'.str_replace('.', '\.', JmapCapabilities::AVAILABILITY)) ?? []);
        $account = $session->json('accounts.carol.accountCapabilities');
        $this->assertIsArray($account);
        $this->assertSame(
            ['maxIdsPerCall' => 50, 'maxWeeksPerCall' => 54, 'maxPersonWeeksPerCall' => 540],
            $account[JmapCapabilities::AVAILABILITY] ?? null,
        );
    }

    public function test_same_team_is_listed_and_readable(): void
    {
        $this->seedEventViaPdo('bob', 'a.ics', $this->eventIcs('a', ':20300107T100000Z', ':20300107T110000Z', ['SUMMARY:Secret']));

        $get = $this->jmapCall('carol', 'TeamMember/get', ['ids' => null]);
        $this->assertSame(['bob'], array_column($get['list'], 'id'));
        $this->assertSame('Bob', $get['list'][0]['name']);
        $this->assertFalse($get['list'][0]['isSelf']);
        $this->assertSame([], $get['notFound']);

        $availability = $this->availability('carol', ['bob']);
        $this->assertSame([], $availability['notFound']);
        $this->assertSame('bob', $availability['list'][0]['id']);
        $this->assertTrue($availability['list'][0]['complete']);
        $this->assertSame([[
            'start' => '2030-01-07T10:00:00Z',
            'timeZone' => null,
            'duration' => 'PT1H',
            'showWithoutTime' => false,
        ]], $availability['list'][0]['periods']);
    }

    public function test_every_refusal_is_the_same_not_found(): void
    {
        $this->seedWgwUser('dave', displayName: 'Dave');
        app(AvailabilitySettings::class)->setEnabled('dave', true);
        app(AvailabilitySettings::class)->setEnabled('carol', true);
        User::query()->where('username', 'carol')->update(['enabled' => false]);

        // dave shares no Team; alice is an instance admin outside Team eng.
        $ids = ['dave', 'carol', 'nobody', 'principals/bob'];
        $get = $this->jmapCall('bob', 'TeamMember/get', ['ids' => $ids]);
        $this->assertSame([], $get['list']);
        $this->assertSame($ids, $get['notFound']);
        $this->assertSame($ids, $this->availability('bob', $ids)['notFound']);

        $this->assertSame(['bob'], $this->availability('alice', ['bob'])['notFound']);
        $this->assertSame([], $this->jmapCall('alice', 'TeamMember/get', ['ids' => null])['list']);
    }

    public function test_switch_off_hides_the_owner_and_the_callers_own_id(): void
    {
        $this->assertSame(['carol'], $this->availability('bob', ['carol'])['notFound']);
        $this->assertSame(['carol'], $this->availability('carol', ['carol'])['notFound']);

        $self = $this->jmapCall('bob', 'TeamMember/get', ['ids' => ['bob']]);
        $this->assertTrue($self['list'][0]['isSelf']);
        $this->assertSame('bob', $this->availability('bob', ['bob'])['list'][0]['id']);

        app(AvailabilitySettings::class)->setEnabled('bob', false);
        $this->assertSame(['bob'], $this->availability('bob', ['bob'])['notFound']);
        $this->assertSame(['bob'], $this->availability('carol', ['bob'])['notFound']);
    }

    public function test_removed_from_the_team_is_not_found_on_the_next_request(): void
    {
        $this->assertSame([], $this->availability('carol', ['bob'])['notFound']);

        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        GroupMember::query()->where('member_id', $bob->id)->delete();

        $this->assertSame(['bob'], $this->availability('carol', ['bob'])['notFound']);
        $this->assertSame([], $this->jmapCall('carol', 'TeamMember/get', ['ids' => null])['list']);
    }

    public function test_state_and_version_move_on_membership_switch_detail_and_name_changes(): void
    {
        $first = $this->jmapCall('carol', 'TeamMember/get', ['ids' => null]);
        $version = fn (): string => $this->jmapCall('carol', 'TeamMember/get', ['ids' => ['bob']])['list'][0]['version'];
        $state = fn (): string => $this->jmapCall('carol', 'TeamMember/get', ['ids' => null])['state'];
        $this->assertSame($first['state'], $state());

        $before = $version();
        app(AvailabilitySettings::class)->setPref('bob', $this->defaultCalendarId('bob'), null, AvailabilitySettings::DETAIL_DETAILS);
        $afterDetail = $version();
        $this->assertNotSame($before, $afterDetail);

        app(AvailabilitySettings::class)->setPref('bob', $this->defaultCalendarId('bob'), false, null);
        $afterInclude = $version();
        $this->assertNotSame($afterDetail, $afterInclude);

        Principal::query()->where('uri', 'principals/bob')->update(['displayname' => 'Robert']);
        $afterName = $version();
        $this->assertNotSame($afterInclude, $afterName);

        $stateBefore = $state();
        app(AvailabilitySettings::class)->setEnabled('bob', true);
        $this->assertNotSame($afterName, $version(), 'A switch write moves the stamp.');
        $this->assertNotSame($stateBefore, $state());

        $stateBefore = $state();
        $this->seedWgwUser('erin', displayName: 'Erin');
        $erin = Principal::forUsername('erin');
        $team = Principal::query()->where('uri', 'principals/groups/eng')->first();
        $this->assertNotNull($erin);
        $this->assertNotNull($team);
        $this->addPrincipalToGroup($team, $erin);
        app(AvailabilitySettings::class)->setEnabled('erin', true);
        $this->assertNotSame($stateBefore, $state());
    }

    public function test_limits_are_invalid_arguments_before_any_read(): void
    {
        $ids = array_map(static fn (int $i): string => 'user'.$i, range(1, 51));
        $this->assertInvalid('carol', ['ids' => $ids, 'utcStart' => self::WEEK_START, 'utcEnd' => self::WEEK_END]);
        // 55 weeks, then 11 ids × 50 weeks = 550 person-weeks.
        $this->assertInvalid('carol', ['ids' => ['bob'], 'utcStart' => self::WEEK_START, 'utcEnd' => '2031-01-27T00:00:00Z']);
        $this->assertInvalid('carol', ['ids' => array_slice($ids, 0, 11), 'utcStart' => self::WEEK_START, 'utcEnd' => '2030-12-23T00:00:00Z']);
        $this->assertInvalid('carol', ['ids' => ['bob'], 'utcStart' => '2030-01-08T00:00:00Z', 'utcEnd' => '2030-01-15T00:00:00Z']);
        $this->assertInvalid('carol', ['ids' => ['bob'], 'utcStart' => self::WEEK_START, 'utcEnd' => '2030-01-10T00:00:00Z']);
        $this->assertInvalid('carol', ['ids' => ['bob'], 'utcStart' => '2030-01-07T00:00:00+00:00', 'utcEnd' => self::WEEK_END]);
        $this->assertInvalid('carol', ['ids' => [], 'utcStart' => self::WEEK_START, 'utcEnd' => self::WEEK_END]);

        // 54 weeks and 10 × 54 = 540 person-weeks are allowed.
        $ok = $this->availability('carol', array_slice($ids, 0, 10), '2031-01-20T00:00:00Z');
        $this->assertCount(10, $ok['notFound']);
    }

    public function test_exclude_event_id_works_for_own_editable_and_attended_events(): void
    {
        $own = $this->seedEventViaPdo('bob', 'own.ics', $this->eventIcs('own', ':20300107T100000Z', ':20300107T110000Z'));
        $this->assertSame([], $this->availability('bob', ['bob'], excludeEventId: $own)['list'][0]['periods']);

        $team = $this->seedEventViaPdo('groups/eng', 'team.ics', $this->eventIcs('team', ':20300107T120000Z', ':20300107T130000Z'), 'eng');
        $this->assertSame(['2030-01-07T10:00:00Z'], $this->periodStarts($this->availability('carol', ['bob'], excludeEventId: $team)));

        Principal::query()->where('uri', 'principals/carol')->update(['email' => 'carol@example.test']);
        $invite = $this->seedEventViaPdo('carol', 'invite.ics', $this->eventIcs('invite', ':20300107T140000Z', ':20300107T150000Z', [
            'ORGANIZER:mailto:zed@elsewhere.test',
            'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:carol@example.test',
        ]));
        $this->shareReadOnly('carol', 'bob');
        $this->assertSame(
            ['2030-01-07T10:00:00Z', '2030-01-07T12:00:00Z'],
            $this->periodStarts($this->availability('carol', ['bob'], excludeEventId: $invite)),
        );
    }

    public function test_exclude_event_id_on_a_read_only_shared_calendar_is_invalid(): void
    {
        $theirs = $this->seedEventViaPdo('carol', 'theirs.ics', $this->eventIcs('theirs', ':20300107T100000Z', ':20300107T110000Z'));
        $this->shareReadOnly('carol', 'bob');

        $this->assertInvalid('bob', ['ids' => ['bob'], 'utcStart' => self::WEEK_START, 'utcEnd' => self::WEEK_END, 'excludeEventId' => $theirs]);
        $this->assertInvalid('bob', ['ids' => ['bob'], 'utcStart' => self::WEEK_START, 'utcEnd' => self::WEEK_END, 'excludeEventId' => 'no-such-event']);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed>
     */
    private function jmapCall(string $username, string $method, array $args): array
    {
        $response = $this->withBearer($this->token($username))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::AVAILABILITY],
            'methodCalls' => [[$method, ['accountId' => $username, ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame($method, $response[0], json_encode($response) ?: '');

        return $response[1];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, mixed>
     */
    private function availability(string $username, array $ids, string $utcEnd = self::WEEK_END, ?string $excludeEventId = null): array
    {
        $args = ['ids' => $ids, 'utcStart' => self::WEEK_START, 'utcEnd' => $utcEnd];
        if ($excludeEventId !== null) {
            $args['excludeEventId'] = $excludeEventId;
        }

        return $this->jmapCall($username, 'TeamMember/getAvailability', $args);
    }

    /**
     * @param  array<string, mixed>  $args
     */
    private function assertInvalid(string $username, array $args): void
    {
        $response = $this->withBearer($this->token($username))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::AVAILABILITY],
            'methodCalls' => [['TeamMember/getAvailability', ['accountId' => $username, ...$args], 'c0']],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame(['error', 'invalidArguments'], [$response[0], $response[1]['type'] ?? null], json_encode($args) ?: '');
    }

    /**
     * @param  array<string, mixed>  $availability
     * @return list<string>
     */
    private function periodStarts(array $availability): array
    {
        return array_column($availability['list'][0]['periods'], 'start');
    }

    private function shareReadOnly(string $owner, string $sharee): void
    {
        $response = $this->withBearer($this->token($owner))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['Calendar/set', ['accountId' => $owner, 'update' => ['default' => [
                'shareWith' => [$sharee => ['mayReadItems' => true]],
            ]]], 'c0']],
        ])->assertOk();
        $this->assertSame([], $response->json('methodResponses.0.1.notUpdated') ?? []);
    }

    private function defaultCalendarId(string $username): int
    {
        return (int) CalendarInstance::query()
            ->where('principaluri', 'principals/'.$username)
            ->where('uri', 'default')
            ->value('calendarid');
    }

    private function token(string $username): string
    {
        return $this->tokens[$username] ??= $this->issueBearerTokenFor($username);
    }
}
