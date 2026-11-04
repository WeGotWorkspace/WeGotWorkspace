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
 * @property string $node_id
 * @property list<string>|null $node_ids a selection's node ids (#1905); null for a folder ticket
 * @property string $zip_name
 * @property string $session_family
 * @property Carbon $issued_at
 * @property Carbon $last_seen_at
 * @property Carbon $absolute_expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class DriveFolderDownloadTicket extends Model
{
    use UsesWgwConnection;

    protected $table = 'drive_folder_download_tickets';

    protected $fillable = [
        'secret_hash',
        'username',
        'node_id',
        'node_ids',
        'zip_name',
        'session_family',
        'issued_at',
        'last_seen_at',
        'absolute_expires_at',
    ];

    protected function casts(): array
    {
        return [
            'node_ids' => 'array',
            'issued_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'absolute_expires_at' => 'datetime',
        ];
    }
}
