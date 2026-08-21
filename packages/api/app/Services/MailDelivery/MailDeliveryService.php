<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Illuminate\Support\Facades\Mail;

final class MailDeliveryService
{
    public function __construct(
        private MailDeliverySettingsStore $settings,
        private MailDeliveryTransportResolver $resolver,
        private MailDeliveryMailerFactory $mailers,
        private MailDeliveryFailureClassifier $failures,
    ) {}

    public function loadConfig(): MailDeliveryConfig
    {
        return $this->settings->load();
    }

    /**
     * @return array{config: array<string, mixed>, capability: array<string, mixed>, lastTestSend: array<string, mixed>|null}
     */
    public function adminState(): array
    {
        $config = $this->loadConfig();

        return [
            'config' => $config->publicArray(),
            'capability' => $this->resolver->capability($config),
            'lastTestSend' => $this->settings->lastTestSend(),
        ];
    }

    public function send(OutboundMessage $message, ?MailDeliveryConfig $config = null): DeliveryResult
    {
        $this->assertValidMessage($message);
        $config ??= $this->settings->load();
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
            Mail::mailer(MailDeliveryMailerFactory::MAILER_NAME)->send(
                (new OutboundMessageMail($message))->to($message->to),
            );
        } catch (\Throwable $e) {
            return $this->mapFailure($e, $resolved->name, $at);
        }

        return DeliveryResult::accepted($resolved->name, $at);
    }

    /**
     * @return array{accepted: bool, status: string, transport: string, at: string, message: string|null}
     */
    public function recordTestSend(OutboundMessage $message, ?MailDeliveryConfig $config = null): array
    {
        $result = $this->send($message, $config)->toArray();
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
        return DeliveryResult::failure($this->failures->classify($e), $transport, $at, $e->getMessage());
    }
}
