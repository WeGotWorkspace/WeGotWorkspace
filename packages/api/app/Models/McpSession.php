<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property int|null $user_id
 * @property string|null $client_id
 * @property string $created_at
 * @property string $last_seen_at
 */
final class McpSession extends Model
{
    use UsesWgwConnection;

    protected $table = 'mcp_sessions';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'id',
        'user_id',
        'client_id',
        'created_at',
        'last_seen_at',
    ];
}
