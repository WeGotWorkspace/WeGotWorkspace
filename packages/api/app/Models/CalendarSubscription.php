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
        'calendar_uri',
        'url',
        'name',
        'color',
        'last_fetched_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'last_fetched_at' => 'datetime',
    ];
}
