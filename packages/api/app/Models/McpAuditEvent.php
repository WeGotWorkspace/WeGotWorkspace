<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $event_type
 * @property string|null $username
 * @property string|null $client_id
 * @property string|null $client_name
 * @property string|null $tool
 * @property string|null $access
 * @property string $outcome
 * @property string|null $target
 * @property string $created_at
 */
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
