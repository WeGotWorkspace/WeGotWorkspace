<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $username
 * @property string $client_id
 * @property string|null $user_agent
 * @property string $approved_at
 */
final class McpConsent extends Model
{
    use UsesWgwConnection;

    protected $table = 'mcp_consents';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'client_id',
        'user_agent',
        'approved_at',
    ];
}
