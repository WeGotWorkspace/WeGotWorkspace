<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarRsvpToken;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use App\Services\MailDelivery\OutboundMessage;
use Illuminate\Support\Str;
use Sabre\VObject\ITip\Message;

/**
 * Sends iMIP (RFC 6047) for attendees who are not local principals.
 */
final class CalendarImipService
{
    public function __construct(
        private readonly MailDeliveryService $mail,
        private readonly MailDeliveryTransportResolver $resolver,
        private readonly CalendarPrincipalAddresses $addresses,
    ) {}

    public function deliver(string $organizerUsername, Message $message): void
    {
        $outbound = $this->compose($organizerUsername, $message);
        if ($outbound === null) {
            return;
        }

        $this->mail->send($outbound);
    }

    public function compose(string $organizerUsername, Message $message): ?OutboundMessage
    {
        $to = $this->addresses->normalizedEmail((string) $message->recipient);
        if ($to === null) {
            return null;
        }

        $config = $this->mail->loadConfig();
        $capability = $this->resolver->capability($config);
        if (! ($capability['canSubmit'] ?? false)) {
            return null;
        }

        $method = strtoupper((string) $message->method);
        $ics = $message->message->serialize();
        $title = $this->summary($ics) ?? 'Calendar invitation';
        $url = null;
        if ($method === 'CANCEL') {
            $this->invalidateTokens((string) $message->uid, $to);
        } else {
            $url = rtrim((string) config('app.url'), '/').'/calendar/rsvp/'.$this->issueToken(
                (string) $message->uid,
                $to,
                $organizerUsername,
            );
        }
        $text = $method === 'CANCEL'
            ? "This event was cancelled.\n"
            : "You are invited to {$title}.\nRespond: {$url}\n";
        $html = $method === 'CANCEL'
            ? '<p>This event was cancelled.</p>'
            : '<p>You are invited to '.e($title).'.</p><p><a href="'.e($url).'">Respond to this invitation</a></p>';

        return new OutboundMessage(
            from: $config->from,
            to: [$to],
            subject: ($method === 'CANCEL' ? 'Cancelled: ' : 'Invitation: ').$title,
            textBody: $text,
            htmlBody: $html,
            calendarMethod: $method,
            calendarIcs: $ics,
        );
    }

    public function issueToken(string $eventUid, string $attendeeEmail, string $organizerUsername): string
    {
        $token = Str::lower(Str::random(48));
        CalendarRsvpToken::query()->create([
            'token' => $token,
            'event_uid' => $eventUid,
            'attendee_email' => $attendeeEmail,
            'organizer_username' => $organizerUsername,
            'expires_at' => time() + 60 * 60 * 24 * 90,
            'used_partstat' => null,
        ]);

        return $token;
    }

    public function invalidateTokens(string $eventUid, string $attendeeEmail): void
    {
        CalendarRsvpToken::query()
            ->where('event_uid', $eventUid)
            ->where('attendee_email', $attendeeEmail)
            ->update(['expires_at' => time() - 1]);
    }

    private function summary(string $ics): ?string
    {
        if (preg_match('/^SUMMARY:(.+)$/m', $ics, $match) !== 1) {
            return null;
        }

        return trim(str_replace(["\r", '\\n'], '', $match[1]));
    }
}
