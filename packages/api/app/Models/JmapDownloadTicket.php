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
 * @property string $secret_hash
 * @property string $username
 * @property string $blob_id
 * @property string $file_name
 * @property string|null $media_type
 * @property string $session_family
 * @property Carbon $issued_at
 * @property Carbon $last_seen_at
 * @property Carbon $absolute_expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapDownloadTicket extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_download_tickets';

    protected $fillable = [
        'secret_hash',
        'username',
        'blob_id',
        'file_name',
        'media_type',
        'session_family',
        'issued_at',
        'last_seen_at',
        'absolute_expires_at',
    ];

    protected function casts(): array
    {
        return [
            'issued_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'absolute_expires_at' => 'datetime',
        ];
    }
}
