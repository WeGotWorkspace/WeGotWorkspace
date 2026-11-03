<?php

declare(strict_types=1);

namespace App\Services\Notify;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Psr\Http\Client\ClientInterface;

/**
 * Logs carry the push-service host only. The full endpoint URL is a
 * capability token for the subscription, so it never reaches the log.
 */
final class MinishlinkWebPushSender implements WebPushSender
{
    private const LOG_TEXT_LIMIT = 300;

    /**
     * @param  ClientInterface|null  $httpClient  Tests inject a stub; production uses the default Guzzle client.
     */
    public function __construct(
        private readonly PushFailureTally $failures,
        private readonly ?ClientInterface $httpClient = null,
    ) {}

    public static function isIgnorableCalculatorWarning(string $message): bool
    {
        return str_contains($message, 'GMP or BCMath');
    }

    public static function endpointHost(string $endpoint): string
    {
        $host = parse_url(trim($endpoint), PHP_URL_HOST);

        return is_string($host) && $host !== '' ? strtolower($host) : 'invalid-endpoint';
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
            ], [], $this->httpClient ?? self::defaultHttpClient());
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
        } catch (\Throwable $e) {
            $host = self::endpointHost($endpoint);
            Log::warning('vapid_send_failed', [
                'host' => $host,
                'exception' => $e::class,
                'message' => self::forLog($e->getMessage(), $host),
            ]);
            $this->failures->record($host, 0);

            return 0;
        } finally {
            restore_error_handler();
        }

        if ($report->isSuccess()) {
            return 201;
        }

        return $this->logRejection($endpoint, $report);
    }

    /**
     * Expired subscriptions (404/410) are routine and pruned by the caller,
     * so they log at info; every other refusal is a warning.
     */
    private function logRejection(string $endpoint, MessageSentReport $report): int
    {
        $response = $report->getResponse();
        $status = (int) ($response?->getStatusCode() ?? 0);
        $host = self::endpointHost($endpoint);

        $context = [
            'status' => $status,
            'host' => $host,
            'reason' => self::forLog($report->getReason(), $host),
        ];
        $body = self::forLog((string) $response?->getBody(), $host);
        if ($body !== '') {
            $context['body'] = $body;
        }

        Log::log($report->isSubscriptionExpired() ? 'info' : 'warning', 'vapid_send_rejected', $context);
        $this->failures->record($host, $status);

        return $status;
    }

    /**
     * One line, truncated, with any URL on the push host cut back to the host.
     */
    private static function forLog(string $text, string $host): string
    {
        $text = (string) preg_replace('#https?://'.preg_quote($host, '#').'[^\s`\'"]*#i', 'https://'.$host.'/…', $text);
        $text = trim((string) preg_replace('/\s+/', ' ', $text));

        return Str::limit($text, self::LOG_TEXT_LIMIT);
    }

    private static function defaultHttpClient(): Client
    {
        return new Client([
            'allow_redirects' => false,
            'timeout' => 10,
            'connect_timeout' => 5,
        ]);
    }
}
