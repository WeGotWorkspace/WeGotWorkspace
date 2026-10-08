<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\RtcRelayEvent;
use App\Models\RtcSessionMetric;
use Illuminate\Database\Eloquent\Builder;
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
            ->where('reason', '!=', 'refresh')
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
        $joins = (clone $query)->where('join_ms', '>', 0);

        return [
            'samples' => $samples,
            'joinP50Ms' => $this->percentileAt($joins, 'join_ms', 0.50),
            'joinP95Ms' => $this->percentileAt($joins, 'join_ms', 0.95),
            'relayPercent' => $this->percent((clone $query)->where('candidate_type', 'relay')->count(), $samples),
            'failedPairsPercent' => $this->percent((clone $query)->where('failed_pairs', '>', 0)->count(), $samples),
            'fallbackPercent' => $this->percent((clone $query)->where('http_fallback', true)->count(), $samples),
            'pollP95Ms' => $this->percentileAt(clone $query, 'poll_rtt_ms', 0.95),
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
            ->where('reason', '!=', 'refresh')
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
     * One row per percentile: `ORDER BY column, id LIMIT 1 OFFSET floor(p·n)`.
     * The week's samples stay in the database.
     *
     * @param  Builder<RtcSessionMetric>  $query
     */
    private function percentileAt(Builder $query, string $column, float $fraction): ?int
    {
        $count = (clone $query)->count();
        if ($count === 0) {
            return null;
        }

        $offset = (int) floor($fraction * $count);
        if ($offset >= $count) {
            $offset = $count - 1;
        }

        $value = (clone $query)
            ->orderBy($column)
            ->orderBy('id')
            ->offset($offset)
            ->limit(1)
            ->value($column);

        return $value === null ? null : (int) $value;
    }

    private function percent(int $part, int $whole): float
    {
        if ($whole === 0) {
            return 0;
        }

        return round(100 * $part / $whole, 1);
    }
}
