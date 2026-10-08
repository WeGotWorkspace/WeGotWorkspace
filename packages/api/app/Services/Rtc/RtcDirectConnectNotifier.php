<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Events\EventDispatch;
use App\Models\RtcRelayEvent;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Notify\RtcDirectConnectNotify;
use Illuminate\Support\Carbon;

/**
 * Bundles today's `unavailable` relay outcomes into one inbox row per admin.
 * The copy names people and Meet or Docs. It never includes a network class,
 * an address, or a room name.
 */
final class RtcDirectConnectNotifier
{
    public function __construct(
        private EventDispatch $events,
        private AdminRoleResolver $admins,
    ) {}

    public function notifyFromToday(?int $now = null): void
    {
        $now ??= time();
        $start = Carbon::createFromTimestamp($now)->startOfDay()->getTimestamp();
        $rows = RtcRelayEvent::query()
            ->where('outcome', RtcRelayService::OUTCOME_UNAVAILABLE)
            ->where('reason', '!=', 'refresh')
            ->where('created_at', '>=', $start)
            ->where('created_at', '<=', $now)
            ->get(['actor', 'channel']);

        /** @var array<string, array<string, string>> $people */
        $people = [];
        foreach ($rows as $row) {
            $name = trim((string) $row->actor);
            $surface = self::surface((string) $row->channel);
            if ($name === '' || $surface === null) {
                continue;
            }
            $people[$name][$surface] = $surface;
        }
        if ($people === []) {
            return;
        }

        $listed = [];
        foreach ($people as $name => $surfaces) {
            $labels = array_values($surfaces);
            sort($labels);
            $listed[] = ['name' => $name, 'where' => implode(' and ', $labels)];
        }
        usort($listed, static fn (array $a, array $b): int => strcmp($a['name'], $b['name']));

        $admins = $this->admins->adminUsernames();
        if ($admins === []) {
            return;
        }

        $day = Carbon::createFromTimestamp($now)->toDateString();
        $this->events->fireMutation(
            actor: 'system',
            domain: RtcDirectConnectNotify::DOMAIN,
            action: RtcDirectConnectNotify::ACTION,
            target: 'direct-connect',
            data: [
                'recipients' => $admins,
                'count' => count($listed),
                'people' => $listed,
                'navigate' => '/admin/realtime-health',
                'tag' => 'rtc.direct_connect',
                'dedupe_key' => 'rtc.direct_connect:'.$day,
                'supersede' => true,
            ],
        );
    }

    public static function surface(string $channel): ?string
    {
        return match ($channel) {
            'meet' => 'Meet',
            'collab' => 'Docs',
            'principal' => 'Presence',
            default => null,
        };
    }
}
