<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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
