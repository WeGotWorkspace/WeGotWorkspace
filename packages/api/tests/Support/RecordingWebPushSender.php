<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Notify\WebPushSender;

/**
 * Records every push instead of sending it. Answers `status`, or the
 * per-endpoint answer in `statusByEndpoint`; 0 stands for "no answer in time".
 */
final class RecordingWebPushSender implements WebPushSender
{
    /** @var list<array{endpoint: string, payload: string}> */
    public array $sent = [];

    /** @var list<array{endpoints: list<string>, timeout: float, afterResponse: bool}> one row per {@see sendMany()} call */
    public array $batches = [];

    public int $status = 201;

    /** @var array<string, int> */
    public array $statusByEndpoint = [];

    /** Set by a test once the HTTP response is built, so a send can tell when it ran. */
    public bool $responseBuilt = false;

    public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int
    {
        $this->sent[] = ['endpoint' => $endpoint, 'payload' => $payload];

        return $this->statusByEndpoint[$endpoint] ?? $this->status;
    }

    public function sendMany(array $messages, array $vapid, float $timeoutSeconds): array
    {
        $this->batches[] = [
            'endpoints' => array_map(static fn ($message): string => $message->endpoint, $messages),
            'timeout' => $timeoutSeconds,
            'afterResponse' => $this->responseBuilt,
        ];

        return array_map(fn ($message): int => $this->send(
            $message->endpoint,
            $message->p256dh,
            $message->auth,
            $message->payload,
            $vapid,
        ), $messages);
    }

    /**
     * @return list<string>
     */
    public function sentEndpoints(): array
    {
        return array_map(static fn (array $row): string => $row['endpoint'], $this->sent);
    }
}
