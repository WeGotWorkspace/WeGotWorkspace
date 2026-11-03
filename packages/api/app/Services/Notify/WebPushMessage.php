<?php

declare(strict_types=1);

namespace App\Services\Notify;

/**
 * One encrypted-to-be Web Push for one subscription.
 */
final readonly class WebPushMessage
{
    public function __construct(
        public string $endpoint,
        public string $p256dh,
        public string $auth,
        public string $payload,
    ) {}
}
