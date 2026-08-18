<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Mail;

final class MailDeliveryService
{
    public function __construct(
        private MailDeliverySettingsStore $settings,
        private MailDeliveryTransportResolver $resolver,
        private MailDeliveryMailerFactory $mailers,
    ) {}

    /**
     * @return array{config: array<string, mixed>, capability: array<string, mixed>, lastTestSend: array<string, mixed>|null}
     */
    public function adminState(): array
    {
        $config = $this->settings->load();

        return [
            'config' => $config->publicArray(),
            'capability' => $this->resolver->capability($config),
            'lastTestSend' => $this->settings->lastTestSend(),
        ];
    }

    public function send(OutboundMessage $message): DeliveryResult
    {
        $this->assertValidMessage($message);
        $config = $this->settings->load();
        $resolved = $this->resolver->resolve($config);
        $at = now()->toIso8601String();
        $transport = $resolved->name !== '' ? $resolved->name : '';

        if ($resolved->blockStatus !== null) {
            return DeliveryResult::failure($resolved->blockStatus, $transport, $at, $this->blockMessage($resolved->blockStatus));
        }
        if (! $resolved->canAttempt()) {
            return DeliveryResult::failure(DeliveryResult::UNAVAILABLE, $transport, $at, 'No email transport is available.');
        }

        $this->mailers->register($resolved->name, $config);

        try {
            Mail::mailer(MailDeliveryMailerFactory::MAILER_NAME)->raw(
                $message->textBody,
                function (Message $outgoing) use ($message): void {
                    $outgoing->from($message->from);
                    $outgoing->to($message->to);
                    $outgoing->subject($message->subject);
                }
            );
        } catch (\Throwable $e) {
            return $this->mapFailure($e, $resolved->name, $at);
        }

        return DeliveryResult::accepted($resolved->name, $at);
    }

    /**
     * @return array{accepted: bool, status: string, transport: string, at: string, message: string|null}
     */
    public function recordTestSend(OutboundMessage $message): array
    {
        $result = $this->send($message)->toArray();
        $this->settings->storeLastTestSend($result);

        return $result;
    }

    private function assertValidMessage(OutboundMessage $message): void
    {
        if (filter_var(trim($message->from), FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidOutboundMessageException('A valid From address is required.');
        }
        $recipients = array_values(array_filter(
            array_map(static fn (string $email): string => trim($email), $message->to),
            static fn (string $email): bool => filter_var($email, FILTER_VALIDATE_EMAIL) !== false
        ));
        if ($recipients === []) {
            throw new InvalidOutboundMessageException('At least one recipient is required.');
        }
    }

    private function blockMessage(string $status): string
    {
        return match ($status) {
            DeliveryResult::SMTP_AUTH_REQUIRED => 'SMTP authentication is required but no username is configured.',
            default => 'Email delivery is not available with the current settings.',
        };
    }

    private function mapFailure(\Throwable $e, string $transport, string $at): DeliveryResult
    {
        $msg = strtolower($e->getMessage());
        $status = DeliveryResult::UNAVAILABLE;
        if (str_contains($msg, 'timed out') || str_contains($msg, 'timeout')) {
            $status = DeliveryResult::TIMEOUT;
        } elseif (str_contains($msg, 'auth') || str_contains($msg, '535') || str_contains($msg, '534')) {
            $status = DeliveryResult::AUTH;
        } elseif (
            str_contains($msg, 'connect')
            || str_contains($msg, 'connection')
            || str_contains($msg, 'refused')
            || str_contains($msg, 'resolv')
        ) {
            $status = DeliveryResult::CONNECT;
        }

        return DeliveryResult::failure($status, $transport, $at, $e->getMessage());
    }
}
