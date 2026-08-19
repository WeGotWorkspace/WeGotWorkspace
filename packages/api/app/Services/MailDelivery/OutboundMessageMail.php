<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Symfony\Component\Mime\Email;

final class OutboundMessageMail extends Mailable
{
    public function __construct(public readonly OutboundMessage $outbound) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            from: $this->outbound->from,
            subject: $this->outbound->subject,
            using: [
                function (Email $email): void {
                    $email->text($this->outbound->textBody);
                },
            ],
        );
    }

    public function content(): Content
    {
        $html = is_string($this->outbound->htmlBody) && $this->outbound->htmlBody !== ''
            ? $this->outbound->htmlBody
            : '<p>'.e($this->outbound->textBody).'</p>';

        return new Content(htmlString: $html);
    }

    /**
     * @return list<Attachment>
     */
    public function attachments(): array
    {
        $ics = $this->outbound->calendarIcs;
        $method = $this->outbound->calendarMethod;
        if (! is_string($ics) || $ics === '' || ! is_string($method) || $method === '') {
            return [];
        }

        return [
            Attachment::fromData(static fn (): string => $ics, 'invite.ics')
                ->withMime('text/calendar; method='.$method.'; charset=UTF-8'),
        ];
    }
}
