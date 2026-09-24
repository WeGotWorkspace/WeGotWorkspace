<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Exceptions\ApiHttpException;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Services\Installer\InstallerVapidKeyGenerator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class VapidPushService
{
    public function __construct(
        private readonly InstallerVapidKeyGenerator $keys,
        private readonly WebPushSender $sender,
    ) {}

    public function publicKey(): string
    {
        return $this->keys->publicKey();
    }

    /**
     * @param  array{endpoint: string, keys: array{p256dh: string, auth: string}}  $input
     */
    public function subscribe(string $username, array $input, ?string $userAgent = null): PushSubscription
    {
        $endpoint = trim($input['endpoint']);
        $hash = hash('sha256', $endpoint);
        $now = Carbon::now();
        $existing = PushSubscription::query()
            ->where('principal', strtolower($username))
            ->where('endpoint_hash', $hash)
            ->first();
        if ($existing !== null) {
            $existing->p256dh = $input['keys']['p256dh'];
            $existing->auth = $input['keys']['auth'];
            $existing->user_agent = $userAgent;
            $existing->updated_at = $now;
            $existing->save();

            return $existing;
        }

        return PushSubscription::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => strtolower($username),
            'endpoint' => $endpoint,
            'endpoint_hash' => $hash,
            'p256dh' => $input['keys']['p256dh'],
            'auth' => $input['keys']['auth'],
            'user_agent' => $userAgent,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function unsubscribe(string $username, string $endpoint): void
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '') {
            throw new ApiHttpException(400, 'endpoint is required.', 'bad_request');
        }
        PushSubscription::query()
            ->where('principal', strtolower($username))
            ->where('endpoint_hash', hash('sha256', $endpoint))
            ->delete();
    }

    public function pruneEndpoint(string $endpoint): void
    {
        PushSubscription::query()
            ->where('endpoint_hash', hash('sha256', $endpoint))
            ->delete();
    }

    /**
     * Send VAPID for local deliveries that were not acked in the 20s local-ack window.
     */
    public function sweepDue(): int
    {
        $now = Carbon::now();
        $due = NotificationDelivery::query()
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->whereNull('acked_at')
            ->whereNull('sent_at')
            ->where('due_at', '<=', $now)
            ->limit(100)
            ->get();

        $sent = 0;
        foreach ($due as $delivery) {
            $notification = Notification::query()->find($delivery->notification_id);
            if ($notification === null) {
                $delivery->delete();

                continue;
            }
            $completed = $this->sendNotification($notification);
            if ($completed === 0 && $this->principalHasSubscription((string) $notification->principal)) {
                continue;
            }
            $delivery->sent_at = $now;
            $delivery->save();
            $sent += $completed;
        }

        NotificationDelivery::query()
            ->where(function ($q): void {
                $q->whereNotNull('acked_at')
                    ->orWhereNotNull('sent_at');
            })
            ->where('created_at', '<', Carbon::now()->subHours(2))
            ->delete();

        return $sent;
    }

    public function sendNotification(Notification $notification): int
    {
        $payload = json_encode($this->pushPayload($notification), JSON_THROW_ON_ERROR);

        $subs = PushSubscription::query()
            ->where('principal', (string) $notification->principal)
            ->get();
        $completed = 0;
        foreach ($subs as $sub) {
            $status = $this->sender->send(
                (string) $sub->endpoint,
                (string) $sub->p256dh,
                (string) $sub->auth,
                $payload,
                $this->vapidAuth(),
            );
            if ($status === 404 || $status === 410) {
                $this->pruneEndpoint((string) $sub->endpoint);
                $completed++;
            } elseif ($status >= 200 && $status < 300) {
                $completed++;
            }
        }

        return $completed;
    }

    /**
     * Flat fields for Chromium SW parsers; nested `notification` + `web_push: 8030`
     * so Safari PWAs (Content-Type application/notification+json) do not fall
     * back to a generic “Notification” toast with an empty body.
     *
     * @return array{
     *     web_push: int,
     *     notification: array{title: string, body: string, navigate: string, tag: string, renotify: bool, app_badge: int, silent: bool},
     *     title: string,
     *     body: string,
     *     navigate: string,
     *     tag: string,
     *     renotify: bool,
     *     app_badge: int
     * }
     */
    public function pushPayload(Notification $notification): array
    {
        $copy = NotificationCopyFormatter::forNotification($notification);
        $title = $copy['title'];
        $body = (string) ($copy['body'] ?? '');
        $path = (string) $notification->navigate;
        if ($path === '' || ! str_starts_with($path, '/') || str_starts_with($path, '//')) {
            $path = '/';
        }
        $tag = (string) ($notification->tag ?? $notification->id);
        $absolute = $this->absoluteNavigate($path);

        return [
            'web_push' => 8030,
            'notification' => [
                'title' => $title,
                'body' => $body,
                'navigate' => $absolute,
                'tag' => $tag,
                'renotify' => true,
                'app_badge' => 1,
                'silent' => false,
            ],
            'title' => $title,
            'body' => $body,
            'navigate' => $path,
            'tag' => $tag,
            'renotify' => true,
            'app_badge' => 1,
        ];
    }

    public function absoluteNavigate(string $path): string
    {
        $origin = rtrim((string) (config('wgw.public_web_url') ?: config('app.url')), '/');

        return $origin.$path;
    }

    private function principalHasSubscription(string $principal): bool
    {
        return PushSubscription::query()->where('principal', $principal)->exists();
    }

    /**
     * @return array{subject: string, publicKey: string, privateKey: string}
     */
    public function vapidAuth(): array
    {
        return [
            'subject' => (string) config('wgw.vapid.subject', 'mailto:noreply@example.com'),
            'publicKey' => $this->keys->publicKey(),
            'privateKey' => $this->keys->privateKey(),
        ];
    }
}
