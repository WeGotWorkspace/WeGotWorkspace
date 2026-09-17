<?php

declare(strict_types=1);

namespace App\Services\Notify;

use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

final class MinishlinkWebPushSender implements WebPushSender
{
    public static function isIgnorableCalculatorWarning(string $message): bool
    {
        return str_contains($message, 'GMP or BCMath');
    }

    /**
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     */
    public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int
    {
        if (! class_exists(WebPush::class)) {
            Log::warning('vapid_send_skipped', ['reason' => 'web-push library missing']);

            return 0;
        }

        $previous = set_error_handler(function (int $severity, string $message, string $file, int $line) use (&$previous): bool {
            if (self::isIgnorableCalculatorWarning($message)) {
                return true;
            }
            if (is_callable($previous)) {
                return (bool) $previous($severity, $message, $file, $line);
            }

            return false;
        });

        try {
            $webPush = new WebPush([
                'VAPID' => [
                    'subject' => $vapid['subject'],
                    'publicKey' => $vapid['publicKey'],
                    'privateKey' => $vapid['privateKey'],
                ],
            ]);
            $subscription = Subscription::create([
                'endpoint' => $endpoint,
                'publicKey' => $p256dh,
                'authToken' => $auth,
            ]);
            $report = $webPush->sendOneNotification(
                $subscription,
                $payload,
                ['contentType' => 'application/notification+json'],
            );

            return $report->isSuccess() ? 201 : (int) ($report->getResponse()?->getStatusCode() ?: 0);
        } catch (\Throwable $e) {
            Log::warning('vapid_send_failed', [
                'endpoint' => $endpoint,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return 0;
        } finally {
            restore_error_handler();
        }
    }
}
