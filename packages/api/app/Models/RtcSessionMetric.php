<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Anonymous session sample for the real-time health page: no addresses, room
 * names, or user ids. Pruned after 30 days by the scheduler.
 *
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property int $created_at
 * @property string $channel
 * @property int $join_ms
 * @property string $candidate_type
 * @property int $failed_pairs
 * @property int $ice_restarts
 * @property bool $http_fallback
 * @property int $poll_rtt_ms
 * @property string $net
 */
final class RtcSessionMetric extends Model
{
    use UsesWgwConnection;

    public const RETENTION_SECONDS = 30 * 24 * 60 * 60;

    protected $table = 'rtc_session_metrics';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'created_at',
        'channel',
        'join_ms',
        'candidate_type',
        'failed_pairs',
        'ice_restarts',
        'http_fallback',
        'poll_rtt_ms',
        'net',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'http_fallback' => 'boolean',
    ];
}
