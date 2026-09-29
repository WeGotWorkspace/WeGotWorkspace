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
 * @property string $grantee_type
 * @property string|null $grantee_user
 * @property string|null $grantee_email
 * @property string|null $grantee_group
 * @property string $access
 * @property string $status
 * @property string|null $invite_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class DriveShareGrant extends Model
{
    use UsesWgwConnection;

    protected $table = 'drive_share_grants';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'share_id',
        'grantee_type',
        'grantee_user',
        'grantee_email',
        'grantee_group',
        'access',
        'status',
        'invite_token',
    ];

    /** @return BelongsTo<DriveShare, $this> */
    public function share(): BelongsTo
    {
        return $this->belongsTo(DriveShare::class, 'share_id');
    }
}
