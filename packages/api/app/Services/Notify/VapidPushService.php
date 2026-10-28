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
    /** Due deliveries handled per sweep run. */
    private const SWEEP_BATCH = 100;

    /** Shortest wait before a failed delivery is tried again (one cron tick). */
    private const MIN_RETRY_SECONDS = 60;

    /** A delivery that has not gone out this long after it was created is dropped. */
    public const GIVE_UP_AFTER_SECONDS = 3600;

    /**
     * Push service answers that mean the subscription will never accept a push:
     * 400 invalid request, 403 VAPID key mismatch, 404/410 expired or unsubscribed.
     */
    private const PERMANENT_REJECTIONS = [400, 403, 404, 410];

    /** @var array<string, true> endpoint hashes that failed transiently during the current sweep */
    private array $failedEndpoints = [];

    public function __construct(
        private readonly InstallerVapidKeyGenerator $keys,
        private readonly WebPushSender $sender,
        private readonly PushEndpointPolicy $endpoints,
    ) {}

    public function publicKey(): string
    {
        return $this->keys->publicKey();
    }

    /**
     * One row per principal + endpoint. Posting it again from another app adds
     * that app's scope; see {@see PushScopes::merge()}.
     *
     * @param  array{endpoint: string, keys: array{p256dh: string, auth: string}, scope?: string|null}  $input
     */
    public function subscribe(string $username, array $input, ?string $userAgent = null): PushSubscription
    {
        $endpoint = trim($input['endpoint']);
        if (! $this->endpoints->isAllowed($endpoint)) {
            throw new ApiHttpException(400, 'Push endpoint is not allowed.', 'bad_request');
        }
        $hash = hash('sha256', $endpoint);
        $scope = $input['scope'] ?? null;
        $now = Carbon::now();
        $existing = PushSubscription::query()
            ->where('principal', strtolower($username))
            ->where('endpoint_hash', $hash)
            ->first();
        if ($existing !== null) {
            $existing->p256dh = $input['keys']['p256dh'];
            $existing->auth = $input['keys']['auth'];
            $existing->user_agent = $userAgent;
            $existing->scopes = PushScopes::encode(PushScopes::merge($existing->scopeList(), $scope));
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
            'scopes' => PushScopes::encode(PushScopes::merge(null, $scope)),
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
     *
     * Oldest due first. A failed delivery is moved back by its own age (at least one
     * tick), so it queues behind newer deliveries, and it is dropped once it is older
     * than GIVE_UP_AFTER_SECONDS. One failing subscription cannot hold up the batch.
     */
    public function sweepDue(): int
    {
        $now = Carbon::now();
        $this->giveUpStaleDeliveries($now);

        $due = NotificationDelivery::query()
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->whereNull('acked_at')
            ->whereNull('sent_at')
            ->where('due_at', '<=', $now)
            ->orderBy('due_at')
            ->orderBy('id')
            ->limit(self::SWEEP_BATCH)
            ->get();

        $sent = 0;
        $this->failedEndpoints = [];
        try {
            foreach ($due as $delivery) {
                $notification = Notification::query()->find($delivery->notification_id);
                if ($notification === null) {
                    $delivery->delete();

                    continue;
                }
                $completed = $this->sendNotification($notification);
                if ($completed === 0 && $this->receivingSubscriptions($notification) !== []) {
                    $this->scheduleRetry($delivery, $now);

                    continue;
                }
                $delivery->sent_at = $now;
                $delivery->save();
                $sent += $completed;
            }
        } finally {
            $this->failedEndpoints = [];
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

    /**
     * Send to the principal's subscriptions whose app scope covers this
     * notification (#1606); each gets a payload that opens inside its app.
     */
    public function sendNotification(Notification $notification): int
    {
        $payloads = [];
        $completed = 0;
        foreach ($this->receivingSubscriptions($notification) as [$sub, $scope]) {
            if (! $this->endpoints->isAllowed((string) $sub->endpoint)) {
                $this->pruneEndpoint((string) $sub->endpoint);

                continue;
            }
            $hash = (string) $sub->endpoint_hash;
            if (isset($this->failedEndpoints[$hash])) {
                continue;
            }
            $payloads[$scope] ??= json_encode($this->pushPayload($notification, $scope), JSON_THROW_ON_ERROR);
            $status = $this->sender->send(
                (string) $sub->endpoint,
                (string) $sub->p256dh,
                (string) $sub->auth,
                $payloads[$scope],
                $this->vapidAuth(),
            );
            if (in_array($status, self::PERMANENT_REJECTIONS, true)) {
                $this->pruneEndpoint((string) $sub->endpoint);
                $completed++;
            } elseif ($status >= 200 && $status < 300) {
                $completed++;
            } else {
                $this->failedEndpoints[$hash] = true;
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
     *     app_badge: int,
     *     scope: string
     * }
     */
    public function pushPayload(Notification $notification, string $scope = PushScopes::ROOT): array
    {
        $copy = NotificationCopyFormatter::forNotification($notification);
        $title = $copy['title'];
        $body = (string) ($copy['body'] ?? '');
        $path = (string) $notification->navigate;
        if ($path === '' || ! str_starts_with($path, '/') || str_starts_with($path, '//')) {
            $path = '/';
        }
        $path = PushScopes::navigateWithin($path, $scope);
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
            'scope' => $scope,
        ];
    }

    public function absoluteNavigate(string $path): string
    {
        $origin = rtrim((string) (config('wgw.public_web_url') ?: config('app.url')), '/');

        return $origin.$path;
    }

    private function giveUpStaleDeliveries(Carbon $now): void
    {
        NotificationDelivery::query()
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->whereNull('acked_at')
            ->whereNull('sent_at')
            ->where('created_at', '<', $now->copy()->subSeconds(self::GIVE_UP_AFTER_SECONDS))
            ->delete();
    }

    private function scheduleRetry(NotificationDelivery $delivery, Carbon $now): void
    {
        $age = $now->getTimestamp() - $delivery->created_at->getTimestamp();
        $delivery->due_at = $now->copy()->addSeconds(max(self::MIN_RETRY_SECONDS, $age));
        $delivery->save();
    }

    /**
     * @return list<array{0: PushSubscription, 1: string}> subscription and the scope it receives under
     */
    private function receivingSubscriptions(Notification $notification): array
    {
        $receiving = [];
        $subs = PushSubscription::query()
            ->where('principal', (string) $notification->principal)
            ->get();
        foreach ($subs as $sub) {
            $scope = PushScopes::receiving($sub->scopeList(), (string) $notification->domain);
            if ($scope !== null) {
                $receiving[] = [$sub, $scope];
            }
        }

        return $receiving;
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
