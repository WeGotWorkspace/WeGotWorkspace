<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

final class Notification extends Model
{
    use UsesWgwConnection;

    protected $table = 'notifications';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'id',
        'principal',
        'event_id',
        'domain',
        'action',
        'data',
        'title',
        'body',
        'navigate',
        'tag',
        'dedupe_key',
        'read_at',
        'created_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'data' => 'array',
        'read_at' => 'datetime',
        'created_at' => 'datetime',
    ];

    public function deliveries(): HasMany
    {
        return $this->hasMany(NotificationDelivery::class, 'notification_id');
    }
}
