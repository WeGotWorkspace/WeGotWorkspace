<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $jti
 * @property int $expires_at
 * @property int $created_at
 */
final class ApiRevokedToken extends Model
{
    use UsesWgwConnection;

    protected $table = 'api_revoked_tokens';

    protected $primaryKey = 'jti';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'jti',
        'expires_at',
        'created_at',
    ];
}
