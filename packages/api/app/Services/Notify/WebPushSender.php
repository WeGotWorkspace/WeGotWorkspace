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

    /**
     * Sends all messages at once and waits at most `$timeoutSeconds` in total,
     * preparing them included (#1670).
     *
     * @param  list<WebPushMessage>  $messages
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     * @return list<int> HTTP status per message, in order; 0 when no answer arrived in time
     */
    public function sendMany(array $messages, array $vapid, float $timeoutSeconds): array;
}
