<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Notification;
use App\Models\PushSubscription;
use Illuminate\Support\Facades\Log;

use function Illuminate\Support\defer;

/**
 * Web Push for urgent news, sent right after the response of the write that
 * caused it instead of on the cron sweep (#1670). See "Urgent active news" in
 * docs/architecture/notifications.md.
 *
 * Bounded so the web worker is free again quickly: at most
 * `wgw.push.urgent.max_subscriptions` subscriptions per event, all at once,
 * within `wgw.push.urgent.timeout_ms`. Whatever is left stays open for
 * {@see VapidPushService::sweepDue()}, which never repeats a subscription
 * that already got the push.
 */
final class UrgentPushService
{
    /** `domain.action` pairs that skip the local-ack grace. */
    public const ACTIONS = ['meet.started'];

    /**
     * The sweep leaves an urgent delivery alone this long, so it never sends
     * while the after-response send is still running.
     */
    public const SWEEP_HOLD_SECONDS = 5;

    public function __construct(
        private readonly VapidPushService $push,
        private readonly WebPushSender $sender,
    ) {}

    public static function isUrgent(string $domain, string $action): bool
    {
        return in_array($domain.'.'.$action, self::ACTIONS, true);
    }

    /**
     * Queue one send for the inbox rows one event created. The service is
     * resolved when the callback runs, after the response is sent.
     *
     * @param  list<string>  $notificationIds
     */
    public static function sendAfterResponse(array $notificationIds): void
    {
        if ($notificationIds === []) {
            return;
        }
        defer(static function () use ($notificationIds): void {
            app(self::class)->sendNow($notificationIds);
        });
    }

    /**
     * @param  list<string>  $notificationIds
     * @return int subscriptions done with (sent, or pruned after a permanent rejection)
     */
    public function sendNow(array $notificationIds): int
    {
        $started = microtime(true);
        try {
            return $this->send($notificationIds, $started);
        } catch (\Throwable $e) {
            // Never surface after the response; the sweep sends what is left.
            Log::warning('urgent_push_failed', ['exception' => $e::class, 'message' => $e->getMessage()]);

            return 0;
        }
    }

    /**
     * @param  list<string>  $notificationIds
     */
    private function send(array $notificationIds, float $started): int
    {
        $notifications = array_values(Notification::query()->whereIn('id', $notificationIds)->orderBy('id')->get()->all());
        $picked = $this->pick($notifications, $this->maxSubscriptions());

        $messages = [];
        $payloads = [];
        foreach ($picked as [$notification, $sub, $scope]) {
            $key = $notification->id.' '.$scope;
            $payloads[$key] ??= $this->push->encodedPayload($notification, $scope);
            $messages[] = new WebPushMessage(
                (string) $sub->endpoint,
                (string) $sub->p256dh,
                (string) $sub->auth,
                $payloads[$key],
            );
        }

        $statuses = $messages === []
            ? []
            : $this->sender->sendMany($messages, $this->push->vapidAuth(), $this->timeoutSeconds());

        $completed = 0;
        foreach ($picked as $i => [$notification, $sub]) {
            if ($this->push->settle($notification, $sub, $statuses[$i] ?? 0)) {
                $completed++;
            }
        }
        $finished = 0;
        foreach ($notifications as $notification) {
            if ($this->push->finishIfNothingOpen($notification)) {
                $finished++;
            }
        }

        Log::info('urgent_push_sent', [
            'notifications' => count($notifications),
            'subscriptions' => count($picked),
            'completed' => $completed,
            'left_for_sweep' => count($notifications) - $finished,
            'ms' => (int) round((microtime(true) - $started) * 1000),
        ]);

        return $completed;
    }

    /**
     * Up to `$max` open subscriptions, one recipient at a time in turn, each
     * recipient's most recently updated subscription first, so one user with
     * many old devices cannot use up the cap.
     *
     * @param  list<Notification>  $notifications
     * @return list<array{0: Notification, 1: PushSubscription, 2: string}>
     */
    private function pick(array $notifications, int $max): array
    {
        $queues = [];
        foreach ($notifications as $notification) {
            $open = $this->push->openSubscriptions($notification);
            usort($open, static fn (array $a, array $b): int => [$b[0]->updated_at?->getTimestamp() ?? 0, (string) $b[0]->id] <=> [$a[0]->updated_at?->getTimestamp() ?? 0, (string) $a[0]->id]);
            $queues[] = [$notification, $open];
        }

        $picked = [];
        for ($round = 0; count($picked) < $max; $round++) {
            $more = false;
            foreach ($queues as [$notification, $open]) {
                if (! isset($open[$round])) {
                    continue;
                }
                $more = true;
                if (count($picked) >= $max) {
                    break;
                }
                $picked[] = [$notification, $open[$round][0], $open[$round][1]];
            }
            if (! $more) {
                break;
            }
        }

        return $picked;
    }

    private function maxSubscriptions(): int
    {
        return max(0, (int) config('wgw.push.urgent.max_subscriptions', 20));
    }

    private function timeoutSeconds(): float
    {
        return max(0, (int) config('wgw.push.urgent.timeout_ms', 1500)) / 1000;
    }
}
