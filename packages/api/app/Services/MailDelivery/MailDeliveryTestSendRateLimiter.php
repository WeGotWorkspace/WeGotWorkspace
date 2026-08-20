<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Illuminate\Cache\RateLimiter;

final class MailDeliveryTestSendRateLimiter
{
    private const int LIMIT = 5;

    private const int DECAY_SECONDS = 600;

    public function __construct(private RateLimiter $rateLimiter) {}

    public function allow(string $username, string $ip): bool
    {
        if ($this->isDisabled()) {
            return true;
        }

        $key = 'mail-delivery-test:'.strtolower(trim($username)).':'.($ip !== '' ? $ip : 'unknown');
        if ($this->rateLimiter->tooManyAttempts($key, self::LIMIT)) {
            return false;
        }
        $this->rateLimiter->hit($key, self::DECAY_SECONDS);

        return true;
    }

    public static function honorsDisableFlag(string $environment, string $rawFlag): bool
    {
        if (! in_array($environment, ['local', 'testing'], true)) {
            return false;
        }
        $raw = strtolower(trim($rawFlag));

        return in_array($raw, ['1', 'true', 'yes', 'on'], true);
    }

    private function isDisabled(): bool
    {
        if (app()->environment('testing') && ! filter_var(env('WGW_MAIL_DELIVERY_THROTTLE_TESTS', false), FILTER_VALIDATE_BOOLEAN)) {
            return true;
        }

        return self::honorsDisableFlag(
            (string) app()->environment(),
            (string) env('WGW_DISABLE_MAIL_DELIVERY_THROTTLE', ''),
        );
    }
}
