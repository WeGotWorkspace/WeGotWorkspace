<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $username
 * @property string $principal_uri Principal that owns the subscribed calendar: the user's own, or a Team's.
 * @property string $calendar_uri
 * @property string $url
 * @property string|null $name
 * @property string|null $color
 * @property Carbon|null $last_fetched_at
 */
final class CalendarSubscription extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_subscriptions';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'id',
        'username',
        'principal_uri',
        'calendar_uri',
        'url',
        'name',
        'color',
        'last_fetched_at',
    ];

    protected static function booted(): void
    {
        // A row without an explicit owner is a subscription on the user's own calendar.
        self::creating(static function (self $row): void {
            if (($row->principal_uri ?? '') === '') {
                $row->principal_uri = 'principals/'.$row->username;
            }
        });
    }

    /** @var array<string, string> */
    protected $casts = [
        'last_fetched_at' => 'datetime',
    ];
}
