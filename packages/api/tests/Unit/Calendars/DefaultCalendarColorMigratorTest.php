<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Calendars\DefaultCalendarColorMigrator;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class DefaultCalendarColorMigratorTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    public function test_migrator_assigns_distinct_colors_to_colorless_provisioned_calendars(): void
    {
        $this->seedWgwUser('color-user');
        $principalUri = 'principals/color-user';
        $this->createCalendar($principalUri, CalendarCollectionUris::EVENT_DEFAULT, 'Calendar');
        $this->createCalendar($principalUri, CalendarCollectionUris::EVENT_HOME, 'Home');
        $this->createCalendar($principalUri, CalendarCollectionUris::EVENT_WORK, 'Work');

        $result = app(DefaultCalendarColorMigrator::class)->migrateAll();

        $this->assertSame(3, $result['scanned']);
        $this->assertSame(3, $result['updated']);
        $this->assertSame(0, $result['skipped']);

        $colors = $this->storedColors($principalUri, [
            CalendarCollectionUris::EVENT_DEFAULT,
            CalendarCollectionUris::EVENT_HOME,
            CalendarCollectionUris::EVENT_WORK,
        ]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_DEFAULT), $colors[CalendarCollectionUris::EVENT_DEFAULT]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_HOME), $colors[CalendarCollectionUris::EVENT_HOME]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_WORK), $colors[CalendarCollectionUris::EVENT_WORK]);
        $this->assertCount(3, array_unique($colors));
    }

    public function test_migrator_rewrites_shared_indigo_but_leaves_custom_and_extra_calendars(): void
    {
        $this->seedWgwUser('custom-color-user');
        $principalUri = 'principals/custom-color-user';
        $this->createCalendar($principalUri, CalendarCollectionUris::EVENT_HOME, 'Home', CalendarColorPalette::SHARED_DEFAULT);
        $this->createCalendar($principalUri, CalendarCollectionUris::EVENT_WORK, 'Work', '#ec4899');
        $this->createCalendar($principalUri, 'projects', 'Projects', CalendarColorPalette::SHARED_DEFAULT);
        $this->createCalendar($principalUri, 'notes', 'Notes');

        $result = app(DefaultCalendarColorMigrator::class)->migrateAll();

        $this->assertSame(2, $result['scanned']);
        $this->assertSame(1, $result['updated']);
        $this->assertSame(1, $result['skipped']);

        $colors = $this->storedColors($principalUri, [
            CalendarCollectionUris::EVENT_HOME,
            CalendarCollectionUris::EVENT_WORK,
            'projects',
            'notes',
        ]);
        $this->assertSame(CalendarColorPalette::forUri(CalendarCollectionUris::EVENT_HOME), $colors[CalendarCollectionUris::EVENT_HOME]);
        $this->assertSame('#ec4899', $colors[CalendarCollectionUris::EVENT_WORK]);
        $this->assertSame(CalendarColorPalette::SHARED_DEFAULT, $colors['projects']);
        $this->assertNull($colors['notes']);
    }

    public function test_migrator_colors_group_calendar_and_is_idempotent(): void
    {
        $group = $this->seedWgwGroup('principals/groups/engineering', 'Engineering');
        $this->createCalendar((string) $group->uri, 'engineering', 'Engineering');

        $migrator = app(DefaultCalendarColorMigrator::class);
        $first = $migrator->migrateAll();
        $second = $migrator->migrateAll();

        $this->assertSame(1, $first['updated']);
        $this->assertSame(0, $second['updated']);
        $this->assertSame(1, $second['skipped']);

        $colors = $this->storedColors((string) $group->uri, ['engineering']);
        $this->assertSame(CalendarColorPalette::forUri('engineering'), $colors['engineering']);
        $this->assertNotSame(CalendarColorPalette::SHARED_DEFAULT, $colors['engineering']);
    }

    private function createCalendar(string $principalUri, string $uri, string $displayName, ?string $color = null): void
    {
        $properties = [
            '{DAV:}displayname' => $displayName,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ];
        if ($color !== null) {
            $properties[CalendarColorPalette::PROPERTY] = $color;
        }

        (new CalPDO(DB::connection('wgw')->getPdo()))->createCalendar($principalUri, $uri, $properties);
    }

    /**
     * @param  list<string>  $uris
     * @return array<string, ?string>
     */
    private function storedColors(string $principalUri, array $uris): array
    {
        $colors = [];
        foreach ($uris as $uri) {
            $instance = CalendarInstance::query()
                ->where('principaluri', $principalUri)
                ->where('uri', $uri)
                ->first();
            $this->assertNotNull($instance, "Missing calendar {$uri}");
            $normalized = CalendarColorPalette::normalize($instance->calendarcolor);
            $colors[$uri] = $normalized;
        }

        return $colors;
    }
}
