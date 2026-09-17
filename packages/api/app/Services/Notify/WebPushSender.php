<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * Sends a Web Push. Implementations must never throw into the write path —
 * sweep callers already isolate failures.
 */
interface WebPushSender
{
    /**
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     * @return int HTTP status from the push service (0 if skipped)
     */
    public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int;
}
