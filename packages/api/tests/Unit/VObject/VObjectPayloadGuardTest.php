<?php

declare(strict_types=1);

namespace Tests\Unit\VObject;

use App\Exceptions\ApiHttpException;
use App\Services\VObject\VObjectPayloadGuard;
use PHPUnit\Framework\TestCase;

final class VObjectPayloadGuardTest extends TestCase
{
    private VObjectPayloadGuard $guard;

    protected function setUp(): void
    {
        parent::setUp();
        $this->guard = new VObjectPayloadGuard;
    }

    public function test_accepts_vcard_at_size_boundary(): void
    {
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES - 120);
        $vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Boundary\r\nNOTE:{$padding}\r\nEND:VCARD\r\n";

        $this->guard->assertVCardSize($vcard);
        $document = $this->guard->readVCard($vcard);
        $this->assertSame('Boundary', (string) $document->FN->getValue());
    }

    public function test_rejects_vcard_one_byte_over_size_boundary(): void
    {
        $oversized = str_repeat('x', VObjectPayloadGuard::MAX_VCARD_BYTES + 1);

        try {
            $this->guard->assertVCardSize($oversized);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(413, $e->getStatusCode());
            $this->assertSame('payload_too_large', $e->errorCode());
        }
    }

    public function test_accepts_ics_at_size_boundary(): void
    {
        $header = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:boundary\r\nSUMMARY:Boundary\r\nDESCRIPTION:";
        $footer = "\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        $padding = str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES - strlen($header) - strlen($footer));
        $ics = $header.$padding.$footer;
        $this->assertSame(VObjectPayloadGuard::MAX_ICS_BYTES, strlen($ics));

        $this->guard->assertIcsSize($ics);
        $document = $this->guard->readICalendar($ics);
        $this->assertSame('Boundary', (string) $document->VEVENT->SUMMARY->getValue());
    }

    public function test_rejects_ics_one_byte_over_size_boundary(): void
    {
        $oversized = str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES + 1);

        try {
            $this->guard->assertIcsSize($oversized);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(413, $e->getStatusCode());
            $this->assertSame('payload_too_large', $e->errorCode());
        }
    }

    public function test_accepts_combined_component_count_at_boundary_including_nested_valarm(): void
    {
        // 62 plain VEVENTs + 1 VEVENT + 1 nested VALARM = 64.
        $events = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS - 2; $i++) {
            $events[] = "BEGIN:VEVENT\r\nUID:evt-{$i}\r\nSUMMARY:E{$i}\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nEND:VEVENT";
        }
        $withAlarm = "BEGIN:VEVENT\r\nUID:evt-alarm\r\nSUMMARY:Alarm\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\n"
            ."BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Ping\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n"
            .'END:VEVENT';
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n".implode("\r\n", $events)."\r\n{$withAlarm}\r\nEND:VCALENDAR\r\n";

        $document = $this->guard->readICalendar($ics);
        $this->assertNotNull($document->VEVENT);
    }

    public function test_rejects_combined_component_count_one_over_boundary(): void
    {
        $chunks = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS + 1; $i++) {
            $chunks[] = "BEGIN:VEVENT\r\nUID:evt-{$i}\r\nSUMMARY:E{$i}\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z\r\nEND:VEVENT";
        }
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n".implode("\r\n", $chunks)."\r\nEND:VCALENDAR\r\n";

        try {
            $this->guard->readICalendar($ics);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(400, $e->getStatusCode());
            $this->assertSame('bad_request', $e->errorCode());
        }
    }

    public function test_vtimezone_standard_daylight_do_not_count_toward_component_cap(): void
    {
        $events = [];
        for ($i = 0; $i < VObjectPayloadGuard::MAX_ICALENDAR_COMPONENTS; $i++) {
            $events[] = "BEGIN:VEVENT\r\nUID:evt-{$i}\r\nSUMMARY:E{$i}\r\nDTSTART;TZID=Europe/Amsterdam:20260701T090000\r\nDTEND;TZID=Europe/Amsterdam:20260701T100000\r\nEND:VEVENT";
        }
        $tz = "BEGIN:VTIMEZONE\r\nTZID:Europe/Amsterdam\r\n"
            ."BEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nTZNAME:CET\r\nEND:STANDARD\r\n"
            ."BEGIN:DAYLIGHT\r\nDTSTART:19700329T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nTZNAME:CEST\r\nEND:DAYLIGHT\r\n"
            .'END:VTIMEZONE';
        $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{$tz}\r\n".implode("\r\n", $events)."\r\nEND:VCALENDAR\r\n";

        $document = $this->guard->readICalendar($ics);
        $this->assertNotNull($document->VEVENT);
    }

    public function test_accepts_vcard_at_property_count_boundary(): void
    {
        $props = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:Props'];
        // VERSION + FN already counted; fill to exactly MAX_VCARD_PROPERTIES children.
        $remaining = VObjectPayloadGuard::MAX_VCARD_PROPERTIES - 2;
        for ($i = 0; $i < $remaining; $i++) {
            $props[] = "X-CUSTOM-{$i}:v{$i}";
        }
        $props[] = 'END:VCARD';
        $vcard = implode("\r\n", $props)."\r\n";

        $document = $this->guard->readVCard($vcard);
        $this->assertSame('Props', (string) $document->FN->getValue());
    }

    public function test_rejects_vcard_one_property_over_boundary(): void
    {
        $props = ['BEGIN:VCARD', 'VERSION:4.0', 'FN:TooMany'];
        $remaining = VObjectPayloadGuard::MAX_VCARD_PROPERTIES - 1;
        for ($i = 0; $i < $remaining; $i++) {
            $props[] = "X-CUSTOM-{$i}:v{$i}";
        }
        $props[] = 'END:VCARD';
        $vcard = implode("\r\n", $props)."\r\n";

        try {
            $this->guard->readVCard($vcard);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(400, $e->getStatusCode());
            $this->assertSame('bad_request', $e->errorCode());
        }
    }
}
