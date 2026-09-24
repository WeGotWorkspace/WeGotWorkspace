<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class McpAuditEvent extends Model
{
    use UsesWgwConnection;

    protected $table = 'mcp_audit_events';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'event_type',
        'username',
        'client_id',
        'client_name',
        'tool',
        'access',
        'outcome',
        'target',
        'created_at',
    ];
}
