<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\RtcRelayEvent;
use App\Models\RtcSessionMetric;
use Illuminate\Support\Carbon;

/**
 * Aggregates anonymous session samples and relay decisions for the admin page.
 * Windows are rolling. Nothing here is an address, a room name, or a user id.
 */
final class RtcRealtimeHealthService
{
    private const DAY_SECONDS = 86400;

    private const WEEK_SECONDS = 7 * self::DAY_SECONDS;

    /** @var list<string> */
    private const CONSTRAINED_NETS = ['symmetric', 'udp-blocked'];

    /** @var list<string> */
    private const RELAY_OUTCOMES = [
        RtcRelayService::OUTCOME_ISSUED,
        RtcRelayService::OUTCOME_UNAVAILABLE,
        RtcRelayService::OUTCOME_DENIED,
    ];

    public function __construct(private RtcTurnCredentialService $turn) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(?int $now = null): array
    {
        $now ??= time();
        $weekStart = $now - self::WEEK_SECONDS;
        $unavailableActors = RtcRelayEvent::query()
            ->where('outcome', RtcRelayService::OUTCOME_UNAVAILABLE)
            ->where('created_at', '>=', $weekStart)
            ->where('created_at', '<=', $now)
            ->pluck('actor')
            ->map(static fn (mixed $actor): string => is_string($actor) ? $actor : '')
            ->filter(static fn (string $actor): bool => $actor !== '')
            ->unique()
            ->values();
        $unavailablePeople = $unavailableActors->count();
        $turnConfigured = $this->turn->available();

        return [
            'day' => $this->window($now - self::DAY_SECONDS, $now),
            'week' => $this->window($weekStart, $now),
            'relayDays' => $this->relayDays($now),
            'turnConfigured' => $turnConfigured,
            'unavailablePeopleThisWeek' => $unavailablePeople,
            'callout' => (! $turnConfigured && $unavailablePeople > 0)
                ? $unavailablePeople." people couldn't connect directly this week. Set up TURN."
                : null,
            'retentionDays' => (int) (RtcSessionMetric::RETENTION_SECONDS / self::DAY_SECONDS),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function window(int $start, int $now): array
    {
        $query = RtcSessionMetric::query()
            ->where('created_at', '>=', $start)
            ->where('created_at', '<=', $now);
        $samples = (clone $query)->count();
        $join = (clone $query)
            ->where('join_ms', '>', 0)
            ->orderBy('join_ms')
            ->pluck('join_ms')
            ->map(static fn (mixed $value): int => (int) $value)
            ->all();
        $poll = (clone $query)
            ->orderBy('poll_rtt_ms')
            ->pluck('poll_rtt_ms')
            ->map(static fn (mixed $value): int => (int) $value)
            ->all();

        return [
            'samples' => $samples,
            'joinP50Ms' => $this->percentile($join, 50),
            'joinP95Ms' => $this->percentile($join, 95),
            'relayPercent' => $this->percent((clone $query)->where('candidate_type', 'relay')->count(), $samples),
            'failedPairsPercent' => $this->percent((clone $query)->where('failed_pairs', '>', 0)->count(), $samples),
            'fallbackPercent' => $this->percent((clone $query)->where('http_fallback', true)->count(), $samples),
            'pollP95Ms' => $this->percentile($poll, 95),
            'constrainedPercent' => $this->percent(
                (clone $query)->whereIn('net', self::CONSTRAINED_NETS)->count(),
                $samples,
            ),
            'byChannel' => [
                'meet' => (clone $query)->where('channel', 'meet')->count(),
                'collab' => (clone $query)->where('channel', 'collab')->count(),
            ],
        ];
    }

    /**
     * @return list<array{date: string, issued: int, unavailable: int, denied: int}>
     */
    private function relayDays(int $now): array
    {
        $today = Carbon::createFromTimestamp($now)->startOfDay();
        $start = $today->copy()->subDays(6)->getTimestamp();
        $buckets = [];
        for ($offset = 6; $offset >= 0; $offset--) {
            $date = $today->copy()->subDays($offset)->toDateString();
            $buckets[$date] = [
                'date' => $date,
                'issued' => 0,
                'unavailable' => 0,
                'denied' => 0,
            ];
        }

        $rows = RtcRelayEvent::query()
            ->where('created_at', '>=', $start)
            ->where('created_at', '<=', $now)
            ->get(['created_at', 'outcome']);
        foreach ($rows as $row) {
            $outcome = (string) $row->outcome;
            if (! in_array($outcome, self::RELAY_OUTCOMES, true)) {
                continue;
            }
            $date = Carbon::createFromTimestamp((int) $row->created_at)->toDateString();
            if (! isset($buckets[$date])) {
                continue;
            }
            $buckets[$date][$outcome]++;
        }

        return array_values($buckets);
    }

    /**
     * @param  array<int, int>  $sorted
     */
    private function percentile(array $sorted, float $p): ?int
    {
        $sorted = array_values($sorted);
        $count = count($sorted);
        if ($count === 0) {
            return null;
        }
        $rank = (int) ceil(($p / 100) * $count);
        $index = max(0, min($count - 1, $rank - 1));

        return $sorted[$index];
    }

    private function percent(int $part, int $whole): float
    {
        if ($whole === 0) {
            return 0;
        }

        return round(100 * $part / $whole, 1);
    }
}
