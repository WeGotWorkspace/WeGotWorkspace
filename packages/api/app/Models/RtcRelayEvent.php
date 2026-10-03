<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * One row per relay request, whatever the outcome. Carries no room name and no
 * addresses, so the real-time health page can read it without leaking who met
 * whom. Pruned after 30 days.
 *
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property int $created_at
 * @property string $channel
 * @property string $actor
 * @property string $reason
 * @property string $outcome
 */
final class RtcRelayEvent extends Model
{
    use UsesWgwConnection;

    public const RETENTION_SECONDS = 30 * 24 * 60 * 60;

    protected $table = 'rtc_relay_events';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'created_at',
        'channel',
        'actor',
        'reason',
        'outcome',
    ];
}
