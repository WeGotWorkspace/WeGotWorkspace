<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $username
 * @property string $blob_id
 * @property string $assembly_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapBlobClaim extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_blob_claims';

    protected $fillable = [
        'username',
        'blob_id',
        'assembly_id',
    ];
}
