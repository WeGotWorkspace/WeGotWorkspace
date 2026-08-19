<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Models\CalendarRsvpToken;
use App\Services\Calendars\CalendarImipService;
use App\Services\MailDelivery\MailDeliveryConfig;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessageMail;
use App\Services\Settings\SettingKeys;
use Illuminate\Support\Facades\Mail;
use Sabre\VObject\ITip\Message;
use Sabre\VObject\Reader;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarImipServiceTest extends WgwDatabaseTestCase
{
    public function test_request_includes_calendar_method_and_hashed_rsvp_token(): void
    {
        $this->enableMailSubmit();

        $outbound = $this->app->make(CalendarImipService::class)->compose('bob', $this->itip('REQUEST'));
        $this->assertNotNull($outbound);
        $this->assertSame(['guest@elsewhere.test'], $outbound->to);
        $this->assertSame('REQUEST', $outbound->calendarMethod);
        $this->assertNotSame('', (string) $outbound->calendarIcs);
        $this->assertStringContainsString('METHOD:REQUEST', (string) $outbound->calendarIcs);
        $this->assertStringContainsString('/calendar/rsvp/', $outbound->textBody);
        $this->assertStringContainsString('/calendar/rsvp/', (string) $outbound->htmlBody);

        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $outbound->textBody, $match));
        $raw = $match[1];
        $row = CalendarRsvpToken::query()->first();
        $this->assertNotNull($row);
        $this->assertNotSame($raw, (string) $row->token_hash);
        $this->assertSame(CalendarRsvpToken::hashRaw($raw), (string) $row->token_hash);
    }

    public function test_reply_is_notification_without_rsvp_token(): void
    {
        $this->enableMailSubmit();

        $outbound = $this->app->make(CalendarImipService::class)->compose(
            'carol',
            $this->itip('REPLY', 'ACCEPTED', 'Carol'),
        );
        $this->assertNotNull($outbound);
        $this->assertSame('REPLY', $outbound->calendarMethod);
        $this->assertStringContainsString('accepted', strtolower($outbound->textBody));
        $this->assertStringContainsString('accepted', strtolower((string) $outbound->htmlBody));
        $this->assertStringNotContainsString('/calendar/rsvp/', $outbound->textBody);
        $this->assertStringNotContainsString('/calendar/rsvp/', (string) $outbound->htmlBody);
        $this->assertSame(0, CalendarRsvpToken::query()->count());
    }

    public function test_deliver_sends_multipart_html_and_calendar(): void
    {
        Mail::fake();
        $this->enableMailSubmit();

        $this->app->make(CalendarImipService::class)->deliver('bob', $this->itip('REQUEST'));

        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            $this->assertSame('REQUEST', $mail->outbound->calendarMethod);
            $this->assertNotSame('', (string) $mail->outbound->htmlBody);
            $this->assertStringContainsString('METHOD:REQUEST', (string) $mail->outbound->calendarIcs);
            $this->assertNotSame([], $mail->attachments());

            return true;
        });
    }

    public function test_deliver_reply_copy_differs_from_request_copy(): void
    {
        Mail::fake();
        $this->enableMailSubmit();
        $imip = $this->app->make(CalendarImipService::class);

        $imip->deliver('bob', $this->itip('REQUEST'));
        $imip->deliver('carol', $this->itip('REPLY', 'DECLINED', 'Carol'));

        Mail::assertSent(OutboundMessageMail::class, 2);
        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REQUEST'
                && str_contains($mail->outbound->textBody, '/calendar/rsvp/');
        });
        Mail::assertSent(OutboundMessageMail::class, function (OutboundMessageMail $mail): bool {
            return $mail->outbound->calendarMethod === 'REPLY'
                && str_contains(strtolower($mail->outbound->textBody), 'declined')
                && ! str_contains($mail->outbound->textBody, '/calendar/rsvp/');
        });
    }

    public function test_significant_update_revokes_previous_token(): void
    {
        $this->enableMailSubmit();
        $imip = $this->app->make(CalendarImipService::class);

        $first = $imip->compose('bob', $this->itip('REQUEST'));
        $this->assertNotNull($first);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $first->textBody, $match));
        $oldRaw = $match[1];
        $this->assertSame(1, CalendarRsvpToken::query()->where('expires_at', '>', time())->count());

        $second = $imip->compose('bob', $this->itip('REQUEST'));
        $this->assertNotNull($second);
        $this->assertSame(1, preg_match('#/calendar/rsvp/([A-Za-z0-9]+)#', $second->textBody, $match));
        $newRaw = $match[1];
        $this->assertNotSame($oldRaw, $newRaw);
        $this->assertSame(1, CalendarRsvpToken::query()->where('expires_at', '>', time())->count());
        $this->assertSame(
            CalendarRsvpToken::hashRaw($newRaw),
            (string) CalendarRsvpToken::query()->where('expires_at', '>', time())->value('token_hash'),
        );
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

    private function enableMailSubmit(): void
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
    }

    private function itip(string $method, string $partstat = 'NEEDS-ACTION', ?string $senderName = null): Message
    {
        $message = new Message;
        $message->uid = 'event-uid-1';
        $message->method = $method;
        $message->recipient = $method === 'REPLY'
            ? 'mailto:bob@example.test'
            : 'mailto:guest@elsewhere.test';
        $message->sender = $method === 'REPLY'
            ? 'mailto:carol@example.test'
            : 'mailto:bob@example.test';
        $message->senderName = $senderName;
        $message->message = Reader::read(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:{$method}\r\nBEGIN:VEVENT\r\nUID:event-uid-1\r\nSUMMARY:External Sync\r\nDTSTART:20300201T100000Z\r\nDTEND:20300201T103000Z\r\nORGANIZER:mailto:bob@example.test\r\nATTENDEE;PARTSTAT={$partstat}:mailto:carol@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        return $message;
    }
}
