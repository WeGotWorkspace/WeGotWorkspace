<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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
