<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Exceptions\ApiHttpException;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalDavCollections;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Database\Eloquent\Builder;
use PHPUnit\Framework\Attributes\DataProvider;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The shared plumbing of the CalDAV collection repositories (#1639). The
 * repositories' own feature tests prove the wiring; these pin each piece.
 */
final class CalDavCollectionsTest extends WgwDatabaseTestCase
{
    private CalDavCollections $collections;

    protected function setUp(): void
    {
        parent::setUp();
        $this->collections = app(CalDavCollections::class);
    }

    public function test_backend_id_is_the_calendar_and_instance_pair(): void
    {
        $instance = (new CalendarInstance)->forceFill(['id' => '12', 'calendarid' => '7']);

        $this->assertSame([7, 12], $this->collections->backendId($instance));
    }

    public function test_principal_uri_of_a_user(): void
    {
        $this->assertSame('principals/bob', $this->collections->principalUri('bob'));
    }

    /**
     * @return iterable<string, array{0: string, 1: ?string}>
     */
    public static function principalUris(): iterable
    {
        yield 'group' => [AdminConstants::GROUP_PREFIX.'team', 'team'];
        yield 'group without a slug' => [AdminConstants::GROUP_PREFIX, null];
        yield 'user' => ['principals/bob', null];
        yield 'prefix lookalike' => ['principals/groupsteam', null];
    }

    #[DataProvider('principalUris')]
    public function test_group_slug_from_principal_uri(string $principalUri, ?string $expected): void
    {
        $this->assertSame($expected, $this->collections->groupSlugFromPrincipalUri($principalUri));
    }

    /**
     * @return iterable<string, array{0: mixed, 1: ?string}>
     */
    public static function patchGroupSlugs(): iterable
    {
        yield 'null' => [null, null];
        yield 'empty' => ['', null];
        yield 'blank' => ['   ', null];
        yield 'slug' => ['team', 'team'];
        yield 'padded slug' => ['  team ', 'team'];
    }

    #[DataProvider('patchGroupSlugs')]
    public function test_normalize_patch_group_slug(mixed $requested, ?string $expected): void
    {
        $this->assertSame($expected, $this->collections->normalizePatchGroupSlug($requested));
    }

    public function test_a_non_string_group_slug_is_invalid(): void
    {
        $this->assertApiError(400, 'invalidProperties', fn () => $this->collections->normalizePatchGroupSlug(5));
        $this->assertApiError(400, 'invalidProperties', fn () => $this->collections->normalizePatchGroupSlug(['team']));
    }

    public function test_find_instance_is_scoped_to_principal_uri_and_kind(): void
    {
        $this->seedWgwUser('bob');
        $this->seedWgwUser('carol');
        $this->provisionUser('bob');
        $this->provisionUser('carol');

        $found = $this->collections->findInstance('principals/bob', CalendarCollectionUris::EVENT_DEFAULT, self::kind(CollectionKind::EventCalendar));

        $this->assertNotNull($found);
        $this->assertSame('principals/bob', (string) $found->principaluri);
        $this->assertTrue($found->relationLoaded('calendar'));
        $this->assertNull($this->collections->findInstance('principals/bob', CalendarCollectionUris::EVENT_DEFAULT, self::kind(CollectionKind::TaskList)));
        $this->assertNull($this->collections->findInstance('principals/bob', 'missing', self::kind(CollectionKind::EventCalendar)));
        $this->assertNotSame(
            (int) $found->id,
            (int) $this->collections->findInstance('principals/carol', CalendarCollectionUris::EVENT_DEFAULT, self::kind(CollectionKind::EventCalendar))?->id,
        );
    }

    public function test_group_instances_provision_the_group_and_list_one_kind(): void
    {
        $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.'team', 'Team');

        $taskLists = $this->collections->groupInstances('team', self::kind(CollectionKind::TaskList));
        $notebooks = $this->collections->groupInstances('team', self::kind(CollectionKind::Notebook));

        $this->assertSame([CalendarCollectionUris::groupTaskListCalDavUri('team')], $this->uris($taskLists));
        $this->assertSame([CalendarCollectionUris::groupNotebookCalDavUri('team')], $this->uris($notebooks));
    }

    public function test_group_instances_come_in_calendar_order(): void
    {
        $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.'team', 'Team');
        $this->collections->groupInstances('team', self::kind(CollectionKind::TaskList));
        app(WgwCalendarBackendFactory::class)->make()->createCollection(
            CollectionKind::TaskList,
            AdminConstants::GROUP_PREFIX.'team',
            'tasks-team-extra',
            [
                '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
            ],
        );
        CalendarInstance::query()->where('uri', 'tasks-team')->update(['calendarorder' => 2]);
        CalendarInstance::query()->where('uri', 'tasks-team-extra')->update(['calendarorder' => 1]);

        $uris = $this->uris($this->collections->groupInstances('team', self::kind(CollectionKind::TaskList)));

        $this->assertSame(['tasks-team-extra', CalendarCollectionUris::groupTaskListCalDavUri('team')], $uris);
    }

    public function test_group_instances_of_an_unknown_group_are_empty(): void
    {
        $this->assertSame([], $this->collections->groupInstances('nobody', self::kind(CollectionKind::TaskList)));
        $this->assertSame(0, CalendarInstance::query()->where('principaluri', AdminConstants::GROUP_PREFIX.'nobody')->count());
    }

    public function test_find_group_instance_by_uri(): void
    {
        $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.'team', 'Team');

        $found = $this->collections->findGroupInstance('team', CalendarCollectionUris::groupNotebookCalDavUri('team'), self::kind(CollectionKind::Notebook));

        $this->assertSame(CalendarCollectionUris::groupNotebookCalDavUri('team'), (string) $found?->uri);
        $this->assertNull($this->collections->findGroupInstance('team', 'notes-other', self::kind(CollectionKind::Notebook)));
        $this->assertNull($this->collections->findGroupInstance('team', CalendarCollectionUris::groupNotebookCalDavUri('team'), self::kind(CollectionKind::TaskList)));
    }

    public function test_owner_scope_without_a_group_is_the_user(): void
    {
        $this->assertSame('principals/bob', $this->collections->ownerScopePrincipalUri('bob', null));
    }

    public function test_owner_scope_for_a_member_is_the_provisioned_group(): void
    {
        $this->bobJoins('team');

        $this->assertSame(AdminConstants::GROUP_PREFIX.'team', $this->collections->ownerScopePrincipalUri('bob', 'team'));
        $this->assertSame(1, CalendarInstance::query()
            ->where('principaluri', AdminConstants::GROUP_PREFIX.'team')
            ->where('uri', CalendarCollectionUris::groupTaskListCalDavUri('team'))
            ->count());
    }

    public function test_owner_scope_for_a_non_member_is_forbidden(): void
    {
        $this->seedWgwUser('bob');
        $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.'team', 'Team');

        $this->assertApiError(403, 'forbidden', fn () => $this->collections->ownerScopePrincipalUri('bob', 'team'));
    }

    public function test_initial_changes_list_every_id_in_order(): void
    {
        $instances = [$this->stubInstance('a', 3), $this->stubInstance('b', 1)];

        foreach ([null, '', '0'] as $since) {
            $this->assertSame(
                ['oldState' => '0', 'newState' => '2:a:3,b:1', 'created' => ['a', 'b'], 'updated' => [], 'destroyed' => []],
                $this->collections->changes($instances, $since, self::uri(...)),
            );
        }
    }

    public function test_ids_come_from_the_callback(): void
    {
        $changes = $this->collections->changes([$this->stubInstance('a', 3)], null, static fn (CalendarInstance $i): string => 'id-'.$i->uri);

        $this->assertSame('1:id-a:3', $changes['newState']);
        $this->assertSame(['id-a'], $changes['created']);
    }

    public function test_a_missing_sync_token_counts_as_one(): void
    {
        $instance = (new CalendarInstance)->forceFill(['uri' => 'a']);
        $instance->setRelation('calendar', new Calendar);

        $this->assertSame('1:a:1', $this->collections->changes([$instance], null, self::uri(...))['newState']);
    }

    public function test_unchanged_state_reports_nothing(): void
    {
        $instances = [$this->stubInstance('a', 3)];

        $this->assertSame(
            ['oldState' => '1:a:3', 'newState' => '1:a:3', 'created' => [], 'updated' => [], 'destroyed' => []],
            $this->collections->changes($instances, '1:a:3', self::uri(...)),
        );
    }

    public function test_changes_report_created_updated_and_destroyed(): void
    {
        $instances = [$this->stubInstance('a', 4), $this->stubInstance('c', 1), $this->stubInstance('b', 2)];

        $this->assertSame(
            ['oldState' => '3:a:3,b:2,gone:5', 'newState' => '3:a:4,c:1,b:2', 'created' => ['c'], 'updated' => ['a'], 'destroyed' => ['gone']],
            $this->collections->changes($instances, '3:a:3,b:2,gone:5', self::uri(...)),
        );
    }

    public function test_changes_since_the_empty_state(): void
    {
        $this->assertSame(
            ['oldState' => '0:', 'newState' => '0:', 'created' => [], 'updated' => [], 'destroyed' => []],
            $this->collections->changes([], '0:', self::uri(...)),
        );
        $this->assertSame(['a'], $this->collections->changes([$this->stubInstance('a', 1)], '0:', self::uri(...))['created']);
        $this->assertSame(['a'], $this->collections->changes([], '1:a:1', self::uri(...))['destroyed']);
    }

    public function test_numeric_ids_stay_strings(): void
    {
        $changes = $this->collections->changes([$this->stubInstance('123', 2)], '1:456:1', self::uri(...));

        $this->assertSame(['123'], $changes['created']);
        $this->assertSame(['456'], $changes['destroyed']);
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function malformedStates(): iterable
    {
        yield 'no separator' => ['garbage'];
        yield 'count too high' => ['2:a:3'];
        yield 'count too low' => ['0:a:3'];
        yield 'missing token' => ['1:a'];
        yield 'non-numeric token' => ['1:a:x'];
        yield 'negative token' => ['1:a:-1'];
        yield 'empty id' => ['1::3'];
        yield 'empty entry' => ['2:a:3,'];
        yield 'non-numeric count' => ['x:a:3'];
    }

    #[DataProvider('malformedStates')]
    public function test_a_malformed_state_cannot_calculate_changes(string $state): void
    {
        $this->assertApiError(400, 'cannotCalculateChanges', fn () => $this->collections->changes([$this->stubInstance('b', 1)], $state, self::uri(...)));
    }

    /**
     * @return \Closure(Builder<Calendar>): void
     */
    private static function kind(CollectionKind $kind): \Closure
    {
        return static function (Builder $query) use ($kind): void {
            $query->ofKind($kind);
        };
    }

    private static function uri(CalendarInstance $instance): string
    {
        return (string) $instance->uri;
    }

    private function stubInstance(string $uri, int $syncToken): CalendarInstance
    {
        $instance = (new CalendarInstance)->forceFill(['uri' => $uri]);
        $instance->setRelation('calendar', (new Calendar)->forceFill(['synctoken' => $syncToken]));

        return $instance;
    }

    private function provisionUser(string $username): void
    {
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
    }

    private function bobJoins(string $slug): void
    {
        $this->seedWgwUser('bob');
        $group = $this->seedWgwGroup(AdminConstants::GROUP_PREFIX.$slug, ucfirst($slug));
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($group, $bob);
    }

    /**
     * @param  list<CalendarInstance>  $instances
     * @return list<string>
     */
    private function uris(array $instances): array
    {
        return array_map(static fn (CalendarInstance $instance): string => (string) $instance->uri, $instances);
    }

    private function assertApiError(int $status, string $code, \Closure $call): void
    {
        try {
            $call();
        } catch (ApiHttpException $e) {
            $this->assertSame($status, $e->getStatusCode(), $e->getMessage());
            $this->assertSame($code, $e->errorCode(), $e->getMessage());

            return;
        }
        $this->fail("Expected ApiHttpException {$status} {$code}.");
    }
}
