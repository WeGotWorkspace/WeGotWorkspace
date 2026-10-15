<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * CalDAV recurrence cap: a long series must not fail the whole calendar,
 * and unbounded hourly rules are rejected on PUT.
 */
final class CalDavRecurrenceCapTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();

        $installRoot = sys_get_temp_dir().'/wgw-caldav-cap-1149-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'admin');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        WgwTestDisks::refresh($dataDir);

        $this->setUpCalendarsFixtures();
    }

    public function test_calendar_query_returns_the_normal_event_when_a_daily_series_starts_in_1900(): void
    {
        $zone = new DateTimeZone('UTC');
        $monthStart = new DateTimeImmutable('first day of this month 00:00:00', $zone);
        $monthEnd = $monthStart->modify('first day of next month 00:00:00');
        $normalStart = $monthStart->modify('+9 days')->setTime(15, 0);
        $normalEnd = $normalStart->modify('+1 hour');

        $this->seedEventViaPdo('bob', 'ancient-daily.ics', $this->seriesIcs(
            'ancient-daily',
            'Ancient daily',
            '19000101T100000Z',
            '19000101T110000Z',
            'FREQ=DAILY',
        ));
        $this->seedEventViaPdo('bob', 'visible-month.ics', $this->seriesIcs(
            'visible-month',
            'Visible this month',
            $normalStart->format('Ymd\THis\Z'),
            $normalEnd->format('Ymd\THis\Z'),
            null,
        ));

        $response = $this->report($this->timeRangeQuery(
            $monthStart->format('Ymd\THis\Z'),
            $monthEnd->format('Ymd\THis\Z'),
        ));

        $response->assertStatus(207);
        $body = (string) $response->getContent();
        $this->assertStringContainsString('visible-month', $body);
        $this->assertStringContainsString('Visible this month', $body);
    }

    public function test_expand_report_for_an_unbounded_daily_series_returns_insufficient_storage(): void
    {
        $zone = new DateTimeZone('UTC');
        $monthStart = new DateTimeImmutable('first day of this month 00:00:00', $zone);
        $monthEnd = $monthStart->modify('first day of next month 00:00:00');
        $this->seedEventViaPdo('bob', 'ancient-daily.ics', $this->seriesIcs(
            'ancient-daily',
            'Ancient daily',
            '19000101T100000Z',
            '19000101T110000Z',
            'FREQ=DAILY',
        ));

        $response = $this->report($this->expandQuery(
            $monthStart->format('Ymd\THis\Z'),
            $monthEnd->format('Ymd\THis\Z'),
        ));

        $response->assertStatus(507);
        $body = (string) $response->getContent();
        $this->assertStringContainsString('d:error', $body);
        $this->assertStringContainsString('InsufficientStorage', $body);
    }

    public function test_put_rejects_unbounded_hourly_and_accepts_hourly_with_count(): void
    {
        $unbounded = $this->davPut('hourly-open.ics', $this->seriesIcs(
            'hourly-open',
            'Hourly open',
            '20261012T100000Z',
            '20261012T110000Z',
            'FREQ=HOURLY',
        ));
        $unbounded->assertStatus(400);
        $this->assertNull(CalendarObject::query()->where('uri', 'hourly-open.ics')->first());

        $counted = $this->davPut('hourly-counted.ics', $this->seriesIcs(
            'hourly-counted',
            'Hourly counted',
            '20261012T100000Z',
            '20261012T110000Z',
            'FREQ=HOURLY;COUNT=10',
        ));
        $counted->assertStatus(201);
        $this->assertNotNull(CalendarObject::query()->where('uri', 'hourly-counted.ics')->first());
    }

    private function seriesIcs(string $uid, string $summary, string $start, string $end, ?string $rule): string
    {
        $rrule = $rule === null ? '' : "RRULE:{$rule}\r\n";

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:{$summary}\r\n"
            ."DTSTART:{$start}\r\nDTEND:{$end}\r\n{$rrule}END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function timeRangeQuery(string $start, string $end): string
    {
        return <<<XML
<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="{$start}" end="{$end}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
XML;
    }

    private function expandQuery(string $start, string $end): string
    {
        return <<<XML
<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-data>
      <C:expand start="{$start}" end="{$end}"/>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
XML;
    }

    private function report(string $xml): TestResponse
    {
        return $this->call(
            'REPORT',
            '/calendars/bob/default/',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
                'CONTENT_TYPE' => 'application/xml',
                'HTTP_DEPTH' => '1',
                'CONTENT_LENGTH' => (string) strlen($xml),
            ],
            $xml,
        );
    }

    private function davPut(string $uri, string $ics): TestResponse
    {
        return $this->call(
            'PUT',
            '/calendars/bob/default/'.$uri,
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('bob:secret'),
                'CONTENT_TYPE' => 'text/calendar',
                'CONTENT_LENGTH' => (string) strlen($ics),
            ],
            $ics,
        );
    }
}
