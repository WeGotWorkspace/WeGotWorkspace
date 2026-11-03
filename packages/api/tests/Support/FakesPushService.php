<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\VAPID;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Real MinishlinkWebPushSender runs against a stub push service: valid
 * subscription and VAPID keys, an HTTP client that returns a canned answer,
 * and a capture of every log line.
 */
trait FakesPushService
{
    /** @var list<MessageLogged> */
    private array $logged = [];

    protected function captureLogs(): void
    {
        $this->logged = [];
        Log::listen(function (MessageLogged $event): void {
            $this->logged[] = $event;
        });
    }

    /**
     * @return list<MessageLogged>
     */
    protected function logsNamed(string $message): array
    {
        return array_values(array_filter(
            $this->logged,
            static fn (MessageLogged $event): bool => $event->message === $message,
        ));
    }

    protected function allLoggedText(): string
    {
        return implode("\n", array_map(
            static fn (MessageLogged $event): string => $event->message.' '.json_encode($event->context, JSON_UNESCAPED_SLASHES),
            $this->logged,
        ));
    }

    /**
     * @param  \Closure(RequestInterface): ResponseInterface  $answer
     */
    protected function pushServiceAnswering(\Closure $answer): ClientInterface
    {
        return new class($answer) implements ClientInterface
        {
            /** @param \Closure(RequestInterface): ResponseInterface $answer */
            public function __construct(private readonly \Closure $answer) {}

            public function sendRequest(RequestInterface $request): ResponseInterface
            {
                return ($this->answer)($request);
            }
        };
    }

    /**
     * @return array{p256dh: string, auth: string}
     */
    protected function subscriptionKeys(): array
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $this->assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        $this->assertIsArray($details);
        $point = "\x04"
            .str_pad($details['ec']['x'], 32, "\0", STR_PAD_LEFT)
            .str_pad($details['ec']['y'], 32, "\0", STR_PAD_LEFT);

        return [
            'p256dh' => self::base64Url($point),
            'auth' => self::base64Url(random_bytes(16)),
        ];
    }

    /**
     * @return array{subject: string, publicKey: string, privateKey: string}
     */
    protected function vapidKeys(): array
    {
        $keys = VAPID::createVapidKeys();

        return [
            'subject' => 'mailto:admin@example.com',
            'publicKey' => $keys['publicKey'],
            'privateKey' => $keys['privateKey'],
        ];
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
