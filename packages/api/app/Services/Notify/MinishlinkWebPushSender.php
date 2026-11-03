<?php

declare(strict_types=1);

namespace App\Services\Notify;

use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface as GuzzleClientInterface;
use GuzzleHttp\Promise\Utils as PromiseUtils;
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
     * @param  GuzzleClientInterface|null  $asyncClient  For {@see sendMany()}; production uses Guzzle's curl multi handler.
     */
    public function __construct(
        private readonly PushFailureTally $failures,
        private readonly ?ClientInterface $httpClient = null,
        private readonly ?GuzzleClientInterface $asyncClient = null,
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

        try {
            $report = $this->withCalculatorWarningsMuted(function () use ($endpoint, $p256dh, $auth, $payload, $vapid) {
                return $this->webPush($vapid)->sendOneNotification(
                    self::subscription($endpoint, $p256dh, $auth),
                    $payload,
                    ['contentType' => 'application/notification+json'],
                );
            });
        } catch (\Throwable $e) {
            $this->logSendFailure($endpoint, $e);

            return 0;
        }

        if ($report->isSuccess()) {
            return 201;
        }

        return $this->logRejection($endpoint, $report);
    }

    /**
     * Encrypts every message, then sends them all at once (Guzzle async requests
     * over curl multi). One deadline covers both steps, so the caller's worker is
     * free after `$timeoutSeconds` at the latest. Unanswered messages report 0.
     *
     * @param  list<WebPushMessage>  $messages
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     * @return list<int>
     */
    public function sendMany(array $messages, array $vapid, float $timeoutSeconds): array
    {
        $deadline = microtime(true) + $timeoutSeconds;
        $statuses = array_fill(0, count($messages), 0);
        if ($messages === []) {
            return [];
        }
        if (! class_exists(WebPush::class)) {
            Log::warning('vapid_send_skipped', ['reason' => 'web-push library missing']);

            return $statuses;
        }

        try {
            [$webPush, $requests] = $this->withCalculatorWarningsMuted(function () use ($messages, $vapid): array {
                $webPush = $this->webPush($vapid);
                $webPush->setReuseVAPIDHeaders(true);
                foreach ($messages as $message) {
                    $webPush->queueNotification(
                        self::subscription($message->endpoint, $message->p256dh, $message->auth),
                        $message->payload,
                        ['contentType' => 'application/notification+json'],
                    );
                }

                return [$webPush, $webPush->takePreparedRequests()];
            });
        } catch (\Throwable $e) {
            foreach ($messages as $message) {
                $this->logSendFailure($message->endpoint, $e);
            }

            return $statuses;
        }

        $remaining = $deadline - microtime(true);
        if ($remaining <= 0.0) {
            return $statuses;
        }
        $client = $this->asyncClient ?? self::defaultAsyncClient();
        $promises = [];
        foreach ($requests as $i => $request) {
            $promises[$i] = $client->sendAsync($request, [
                'timeout' => $remaining,
                'connect_timeout' => $remaining,
                'http_errors' => false,
                'allow_redirects' => false,
            ]);
        }

        foreach (PromiseUtils::settle($promises)->wait() as $i => $result) {
            $endpoint = $messages[$i]->endpoint;
            if ($result['state'] !== 'fulfilled') {
                $reason = $result['reason'];
                $this->logSendFailure($endpoint, $reason instanceof \Throwable ? $reason : new \RuntimeException('push send rejected'));

                continue;
            }
            $report = $webPush->reportFor($requests[$i], $result['value']);
            $statuses[$i] = $report->isSuccess() ? 201 : $this->logRejection($endpoint, $report);
        }

        return array_values($statuses);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $work
     * @return T
     */
    private function withCalculatorWarningsMuted(callable $work): mixed
    {
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
            return $work();
        } finally {
            restore_error_handler();
        }
    }

    /**
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     */
    private function webPush(array $vapid): PreparedWebPush
    {
        return new PreparedWebPush([
            'VAPID' => [
                'subject' => $vapid['subject'],
                'publicKey' => $vapid['publicKey'],
                'privateKey' => $vapid['privateKey'],
            ],
        ], [], $this->httpClient ?? self::defaultHttpClient());
    }

    private static function subscription(string $endpoint, string $p256dh, string $auth): Subscription
    {
        return Subscription::create([
            'endpoint' => $endpoint,
            'publicKey' => $p256dh,
            'authToken' => $auth,
        ]);
    }

    private function logSendFailure(string $endpoint, \Throwable $e): void
    {
        $host = self::endpointHost($endpoint);
        Log::warning('vapid_send_failed', [
            'host' => $host,
            'exception' => $e::class,
            'message' => self::forLog($e->getMessage(), $host),
        ]);
        $this->failures->record($host, 0);
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

    private static function defaultAsyncClient(): Client
    {
        return new Client(['allow_redirects' => false, 'http_errors' => false]);
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
