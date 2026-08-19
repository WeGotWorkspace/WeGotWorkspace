<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Services\Calendars\CalendarImipService;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\Settings\SettingKeys;
use Sabre\VObject\ITip\Message;
use Sabre\VObject\Reader;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarImipServiceTest extends WgwDatabaseTestCase
{
    public function test_request_includes_calendar_method_and_rsvp_url(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'calendar@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
        $this->app->instance(
            MailDeliveryTransportResolver::class,
            new MailDeliveryTransportResolver(
                phpMailProbe: static fn (): bool => true,
                sendmailProbe: static fn (): bool => true,
            ),
        );

        $outbound = $this->app->make(CalendarImipService::class)->compose('bob', $this->itip('REQUEST'));
        $this->assertNotNull($outbound);
        $this->assertSame(['guest@elsewhere.test'], $outbound->to);
        $this->assertSame('REQUEST', $outbound->calendarMethod);
        $this->assertNotSame('', (string) $outbound->calendarIcs);
        $this->assertStringContainsString('METHOD:REQUEST', (string) $outbound->calendarIcs);
        $this->assertStringContainsString('/calendar/rsvp/', $outbound->textBody);
        $this->assertStringContainsString('/calendar/rsvp/', (string) $outbound->htmlBody);
    }

    public function test_skips_compose_when_mail_cannot_submit(): void
    {
        $this->setAppSettings([
            SettingKeys::MAIL_DELIVERY_FROM => 'calendar@example.test',
            SettingKeys::MAIL_DELIVERY_TRANSPORT => MailDeliveryConfig::TRANSPORT_PHP,
        ]);
        $this->app->instance(
            MailDeliveryTransportResolver::class,
            new MailDeliveryTransportResolver(
                phpMailProbe: static fn (): bool => false,
                sendmailProbe: static fn (): bool => false,
            ),
        );

        $this->assertNull(
            $this->app->make(CalendarImipService::class)->compose('bob', $this->itip('REQUEST')),
        );
    }

    private function itip(string $method): Message
    {
        $message = new Message;
        $message->uid = 'event-uid-1';
        $message->method = $method;
        $message->recipient = 'mailto:guest@elsewhere.test';
        $message->message = Reader::read(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:{$method}\r\nBEGIN:VEVENT\r\nUID:event-uid-1\r\nSUMMARY:External Sync\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nORGANIZER:mailto:bob@example.test\r\nATTENDEE:mailto:guest@elsewhere.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        return $message;
    }
}
