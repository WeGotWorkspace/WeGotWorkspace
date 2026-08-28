<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Models\Calendar;
use App\Services\Tasks\DefaultMixedCalendarMigrator;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class DefaultMixedCalendarMigratorTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_migrator_moves_vtodos_from_mixed_default_to_inbox_and_strips_vtodo(): void
    {
        $this->seedWgwUser('mixed-user');
        $principalUri = 'principals/mixed-user';

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VTODO', 'VJOURNAL']),
        ]);

        $this->seedTaskViaPdo('mixed-user', 'todo-one.ics', $this->sampleTodoIcs('In default'), 'default');
        $this->seedTaskViaPdo('mixed-user', 'todo-two.ics', $this->sampleTodoIcs('Also default'), 'default');

        $result = app(DefaultMixedCalendarMigrator::class)->migratePrincipal($principalUri);

        $this->assertTrue($result['migrated']);
        $this->assertSame(2, $result['movedObjects']);

        $inboxTasks = $this->withBearer($this->issueBearerTokenFor('mixed-user'))
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk()
            ->json('list');

        $this->assertCount(2, $inboxTasks);

        $defaultCalendar = Calendar::query()
            ->whereHas('instances', fn ($query) => $query->where('principaluri', $principalUri)->where('uri', 'default'))
            ->first();

        $this->assertNotNull($defaultCalendar);
        $this->assertSame('VEVENT', (string) $defaultCalendar->components);
        $this->assertFalse($defaultCalendar->supportsVtodo());
    }

    public function test_migrator_is_idempotent_for_non_mixed_default(): void
    {
        $this->seedWgwUser('clean-user');
        app(InboxTaskListProvisioner::class)->ensureForPrincipal('principals/clean-user');

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/clean-user', 'default', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ]);

        $migrator = app(DefaultMixedCalendarMigrator::class);
        $this->assertSame(['migrated' => false, 'movedObjects' => 0], $migrator->migratePrincipal('principals/clean-user'));
        $this->assertSame(['migrated' => false, 'movedObjects' => 0], $migrator->migratePrincipal('principals/clean-user'));
    }

    public function test_list_task_lists_never_includes_mixed_default(): void
    {
        $this->seedWgwUser('legacy-mixed');
        $principalUri = 'principals/legacy-mixed';

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar($principalUri, 'default', [
            '{DAV:}displayname' => 'Mixed default',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VTODO']),
        ]);
        app(InboxTaskListProvisioner::class)->ensureForPrincipal($principalUri);

        $token = $this->issueBearerTokenFor('legacy-mixed');
        $ids = collect($this->withBearer($token)->getJson('/api/v1/tasks/tasklists')->json('list'))->pluck('id')->all();
        $this->assertNotContains('default', $ids);
        $this->assertContains(InboxTaskListProvisioner::URI, $ids);
    }
}
