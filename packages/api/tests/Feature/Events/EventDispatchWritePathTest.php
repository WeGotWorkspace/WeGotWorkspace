<?php

declare(strict_types=1);

namespace Tests\Feature\Events;

use App\Dav\Server\EventDispatchPlugin;
use App\Events\EventDispatch;
use App\Services\Calendars\CalendarEventRepository;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\RecordingWorkspaceEventListener;
use Tests\Support\WgwDatabaseTestCase;

final class EventDispatchWritePathTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private RecordingWorkspaceEventListener $recorder;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->recorder = new RecordingWorkspaceEventListener;
        $this->app->instance(EventDispatch::class, new EventDispatch([$this->recorder]));
        $this->app->forgetInstance(CalendarEventRepository::class);
    }

    public function test_calendar_event_repository_create_fires_once(): void
    {
        app(CalendarEventRepository::class)->create('bob', $this->sampleCalendarEventPayload());

        $matches = $this->recorder->matching('calendars', 'created');
        $this->assertCount(1, $matches);
        $this->assertSame('bob', $matches[0]->actor);
        $this->assertStringContainsString('calendars/bob/', $matches[0]->target);
    }

    public function test_dav_plugin_after_write_fires_once(): void
    {
        $plugin = new class($this->app->make(EventDispatch::class)) extends EventDispatchPlugin
        {
            protected function currentActorUsername(): string
            {
                return 'bob';
            }
        };
        $plugin->afterWriteMethod(
            new SabreRequest('PUT', '/calendars/bob/default/evt.ics'),
            new SabreResponse(201),
        );

        $matches = $this->recorder->matching('calendar', 'written');
        $this->assertCount(1, $matches);
        $this->assertSame('bob', $matches[0]->actor);
        $this->assertSame('calendars/bob/default/evt.ics', $matches[0]->target);
    }

    public function test_dav_plugin_skips_non_2xx_and_missing_actor(): void
    {
        $plugin = new class($this->app->make(EventDispatch::class)) extends EventDispatchPlugin
        {
            protected function currentActorUsername(): string
            {
                return '';
            }
        };
        $plugin->afterWriteMethod(
            new SabreRequest('PUT', '/calendars/bob/default/evt.ics'),
            new SabreResponse(201),
        );
        $plugin->afterWriteMethod(
            new SabreRequest('PUT', '/calendars/bob/default/evt.ics'),
            new SabreResponse(412),
        );

        $this->assertSame([], $this->recorder->matching('calendar', 'written'));
    }
}
