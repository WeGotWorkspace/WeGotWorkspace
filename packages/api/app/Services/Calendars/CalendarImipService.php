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

        return match ($method) {
            'CANCEL' => $this->cancelMessage($config->from, $to, $title, $method, $ics, (string) $message->uid),
            'REPLY' => $this->replyMessage($config->from, $to, $title, $method, $ics, $message),
            default => $this->requestMessage($config->from, $to, $title, $method, $ics, (string) $message->uid, $organizerUsername),
        };
    }

    public function issueToken(string $eventUid, string $attendeeEmail, string $organizerUsername): string
    {
        $this->invalidateTokens($eventUid, $attendeeEmail);
        $token = Str::lower(Str::random(48));
        CalendarRsvpToken::query()->create([
            'token_hash' => CalendarRsvpToken::hashRaw($token),
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

    private function requestMessage(
        string $from,
        string $to,
        string $title,
        string $method,
        string $ics,
        string $uid,
        string $organizerUsername,
    ): OutboundMessage {
        $url = rtrim((string) config('app.url'), '/').'/calendar/rsvp/'.$this->issueToken(
            $uid,
            $to,
            $organizerUsername,
        );

        return new OutboundMessage(
            from: $from,
            to: [$to],
            subject: 'Invitation: '.$title,
            textBody: "You are invited to {$title}.\nRespond: {$url}\n",
            htmlBody: '<p>You are invited to '.e($title).'.</p><p><a href="'.e($url).'">Respond to this invitation</a></p>',
            calendarMethod: $method,
            calendarIcs: $ics,
        );
    }

    private function cancelMessage(
        string $from,
        string $to,
        string $title,
        string $method,
        string $ics,
        string $uid,
    ): OutboundMessage {
        $this->invalidateTokens($uid, $to);

        return new OutboundMessage(
            from: $from,
            to: [$to],
            subject: 'Cancelled: '.$title,
            textBody: "This event was cancelled.\n",
            htmlBody: '<p>This event was cancelled.</p>',
            calendarMethod: $method,
            calendarIcs: $ics,
        );
    }

    private function replyMessage(
        string $from,
        string $to,
        string $title,
        string $method,
        string $ics,
        Message $message,
    ): OutboundMessage {
        $status = $this->replyPartstat($ics);
        $actor = is_string($message->senderName) && trim($message->senderName) !== ''
            ? trim($message->senderName)
            : ($this->addresses->normalizedEmail((string) $message->sender) ?? 'An attendee');
        $verb = match ($status) {
            'ACCEPTED' => 'accepted',
            'DECLINED' => 'declined',
            'TENTATIVE' => 'tentatively accepted',
            default => 'responded to',
        };

        return new OutboundMessage(
            from: $from,
            to: [$to],
            subject: $actor.' '.$verb.': '.$title,
            textBody: "{$actor} {$verb} the invitation to {$title}.\n",
            htmlBody: '<p>'.e($actor).' '.e($verb).' the invitation to '.e($title).'.</p>',
            calendarMethod: $method,
            calendarIcs: $ics,
        );
    }

    private function replyPartstat(string $ics): string
    {
        if (preg_match('/PARTSTAT=([A-Z-]+)/i', $ics, $match) === 1) {
            return strtoupper($match[1]);
        }

        return 'NEEDS-ACTION';
    }

    private function summary(string $ics): ?string
    {
        if (preg_match('/^SUMMARY:(.+)$/m', $ics, $match) !== 1) {
            return null;
        }

        return trim(str_replace(["\r", '\\n'], '', $match[1]));
    }
}
