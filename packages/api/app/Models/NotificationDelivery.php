<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class NotificationDelivery extends Model
{
    use UsesWgwConnection;

    public const CHANNEL_LOCAL = 'local';

    public const CHANNEL_VAPID = 'vapid';

    protected $table = 'notification_deliveries';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'id',
        'notification_id',
        'principal',
        'channel',
        'due_at',
        'acked_at',
        'sent_at',
        'created_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'due_at' => 'datetime',
        'acked_at' => 'datetime',
        'sent_at' => 'datetime',
        'created_at' => 'datetime',
    ];

    public function notification(): BelongsTo
    {
        return $this->belongsTo(Notification::class, 'notification_id');
    }
}
