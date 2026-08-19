<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

final class DeliveryResult
{
    public const ACCEPTED_BY_TRANSPORT = 'accepted_by_transport';

    public const UNAVAILABLE = 'unavailable';

    public const CONNECT = 'connect';

    public const AUTH = 'auth';

    public const TIMEOUT = 'timeout';

    public const SMTP_AUTH_REQUIRED = 'smtp_auth_required';

    /**
     * @param  self::ACCEPTED_BY_TRANSPORT|self::UNAVAILABLE|self::CONNECT|self::AUTH|self::TIMEOUT|self::SMTP_AUTH_REQUIRED  $status
     */
    public function __construct(
        public bool $accepted,
        public string $status,
        public string $transport,
        public string $at,
        public ?string $message,
    ) {}

    public static function accepted(string $transport, string $at): self
    {
        return new self(true, self::ACCEPTED_BY_TRANSPORT, $transport, $at, null);
    }

    public static function failure(string $status, string $transport, string $at, ?string $message): self
    {
        return new self(false, $status, $transport, $at, $message);
    }

    /**
     * @return array{accepted: bool, status: string, transport: string, at: string, message: string|null}
     */
    public function toArray(): array
    {
        return [
            'accepted' => $this->accepted,
            'status' => $this->status,
            'transport' => $this->transport,
            'at' => $this->at,
            'message' => $this->message,
        ];
    }
}
