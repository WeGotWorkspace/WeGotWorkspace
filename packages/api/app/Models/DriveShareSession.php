<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $share_id
 * @property string $session_key
 * @property Carbon $expires_at
 * @property Carbon|null $revoked_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class DriveShareSession extends Model
{
    use UsesWgwConnection;

    protected $table = 'drive_share_sessions';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'share_id',
        'session_key',
        'expires_at',
        'revoked_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /** @return BelongsTo<DriveShare, $this> */
    public function share(): BelongsTo
    {
        return $this->belongsTo(DriveShare::class, 'share_id');
    }
}
