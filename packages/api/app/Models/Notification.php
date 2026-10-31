<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use App\Services\Notify\NotificationInboxMarkers;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $principal
 * @property string $event_id
 * @property string $domain
 * @property string $action
 * @property string $title
 * @property string|null $body
 * @property string $navigate
 * @property string|null $tag
 * @property string $dedupe_key
 * @property Carbon|null $read_at
 * @property Carbon $created_at
 * @property array<string, mixed>|null $data
 */
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

    /**
     * Create, supersede, read and clear all move the principal's inbox marker
     * (the `Notification` push state, #1660). Mass `query()->update()` and
     * `query()->delete()` skip model events; inbox writers save per row.
     */
    protected static function booted(): void
    {
        $bump = static function (self $row): void {
            app(NotificationInboxMarkers::class)->bump((string) $row->principal);
        };
        self::created($bump);
        self::updated($bump);
        self::deleted($bump);
    }

    /** @return HasMany<NotificationDelivery, $this> */
    public function deliveries(): HasMany
    {
        return $this->hasMany(NotificationDelivery::class, 'notification_id');
    }
}
